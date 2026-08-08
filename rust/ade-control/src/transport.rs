use crate::protocol::{error_response, CONTROL_PROTOCOL_VERSION};
use crate::session::AgentControlSession;
use crate::transport_endpoint::{
    constant_time_eq, generate_token, read_endpoint_file, validate_endpoint, write_endpoint_file,
    ControlEndpointFile, EndpointRegistration,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const AUTH_LINE_LIMIT: usize = 4 * 1024;
const REQUEST_LINE_LIMIT: usize = 64 * 1024;
const RESPONSE_LINE_LIMIT: usize = 64 * 1024;
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(25);
const SOCKET_IO_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlTransportError {
    EndpointFileExists(PathBuf),
    EndpointRead(String),
    EndpointInvalid(String),
    EndpointWrite(String),
    Entropy(String),
    Bind(String),
    Connect(String),
    Unauthorized,
    ProtocolMismatch { expected: u16, actual: u16 },
    RequestTooLarge,
    ResponseTooLarge,
    InvalidRequestLine,
    Eof,
    Io(String),
    ServerThread(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum AuthKind {
    #[serde(rename = "agent_control_auth")]
    AgentControlAuth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthRequest {
    #[serde(rename = "type")]
    kind: AuthKind,
    protocol_version: u16,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthResponse {
    #[serde(rename = "type")]
    kind: AuthKind,
    protocol_version: u16,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub struct AgentControlServer {
    listener: TcpListener,
    session: Arc<AgentControlSession>,
    endpoint: ControlEndpointFile,
    _registration: EndpointRegistration,
}

impl AgentControlServer {
    pub fn bind(
        state_db: impl AsRef<Path>,
        endpoint_file: impl AsRef<Path>,
    ) -> Result<Self, ControlTransportError> {
        let endpoint_file = endpoint_file.as_ref();
        match fs::symlink_metadata(endpoint_file) {
            Ok(_) => {
                return Err(ControlTransportError::EndpointFileExists(
                    endpoint_file.to_path_buf(),
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(ControlTransportError::EndpointRead(error.to_string())),
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| ControlTransportError::Bind(error.to_string()))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| ControlTransportError::Bind(error.to_string()))?;
        let token = generate_token()?;
        let endpoint = ControlEndpointFile {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            address: listener
                .local_addr()
                .map_err(|error| ControlTransportError::Bind(error.to_string()))?
                .to_string(),
            token: token.clone(),
            server_pid: std::process::id(),
        };
        let session = AgentControlSession::open(state_db)
            .map_err(|error| ControlTransportError::Bind(format!("session:{error:?}")))?;
        write_endpoint_file(endpoint_file, &endpoint)?;
        Ok(Self {
            listener,
            session: Arc::new(session),
            endpoint,
            _registration: EndpointRegistration {
                path: endpoint_file.to_path_buf(),
                token,
            },
        })
    }

    pub fn address(&self) -> Result<SocketAddr, ControlTransportError> {
        self.endpoint
            .address
            .parse()
            .map_err(|error| ControlTransportError::EndpointInvalid(format!("address:{error}")))
    }

    pub fn run_until(self, stop: Arc<AtomicBool>) -> Result<(), ControlTransportError> {
        let mut connections = Vec::new();
        while !stop.load(Ordering::SeqCst) {
            match self.listener.accept() {
                Ok((stream, _)) => {
                    let session = Arc::clone(&self.session);
                    let token = self.endpoint.token.clone();
                    let connection_stop = Arc::clone(&stop);
                    connections.push(thread::spawn(move || {
                        handle_connection(stream, session, token, connection_stop)
                    }));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(SOCKET_POLL_INTERVAL);
                }
                Err(error) => return Err(ControlTransportError::Io(error.to_string())),
            }
        }
        for connection in connections {
            match connection.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    eprintln!("ade-control connection error: {error:?}");
                }
                Err(_) => {
                    return Err(ControlTransportError::ServerThread(
                        "connection thread panicked".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

pub struct AgentControlClient {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
}

impl AgentControlClient {
    pub fn connect(endpoint_file: impl AsRef<Path>) -> Result<Self, ControlTransportError> {
        let endpoint = read_endpoint_file(endpoint_file.as_ref())?;
        validate_endpoint(&endpoint)?;
        let stream = TcpStream::connect(&endpoint.address)
            .map_err(|error| ControlTransportError::Connect(error.to_string()))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| ControlTransportError::Connect(error.to_string()))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| ControlTransportError::Connect(error.to_string()))?;
        let writer = stream
            .try_clone()
            .map_err(|error| ControlTransportError::Connect(error.to_string()))?;
        let mut client = Self {
            writer,
            reader: BufReader::new(stream),
        };
        client.authenticate(&endpoint)?;
        Ok(client)
    }

    pub fn request_line(&mut self, line: &str) -> Result<String, ControlTransportError> {
        if line.len() > REQUEST_LINE_LIMIT {
            return Err(ControlTransportError::RequestTooLarge);
        }
        if line.bytes().any(|byte| matches!(byte, b'\r' | b'\n')) {
            return Err(ControlTransportError::InvalidRequestLine);
        }
        self.writer
            .write_all(line.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .and_then(|_| self.writer.flush())
            .map_err(|error| ControlTransportError::Io(error.to_string()))?;
        read_client_line(&mut self.reader, RESPONSE_LINE_LIMIT)
    }

    pub fn run_jsonl<R: BufRead, W: Write>(
        &mut self,
        reader: R,
        mut writer: W,
    ) -> Result<(), ControlTransportError> {
        for line in reader.lines() {
            let line = line.map_err(|error| ControlTransportError::Io(error.to_string()))?;
            let response = self.request_line(&line)?;
            writer
                .write_all(response.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
                .and_then(|_| writer.flush())
                .map_err(|error| ControlTransportError::Io(error.to_string()))?;
        }
        Ok(())
    }

    fn authenticate(
        &mut self,
        endpoint: &ControlEndpointFile,
    ) -> Result<(), ControlTransportError> {
        let request = AuthRequest {
            kind: AuthKind::AgentControlAuth,
            protocol_version: CONTROL_PROTOCOL_VERSION,
            token: endpoint.token.clone(),
        };
        let line = serde_json::to_string(&request)
            .map_err(|error| ControlTransportError::Io(error.to_string()))?;
        self.writer
            .write_all(line.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .and_then(|_| self.writer.flush())
            .map_err(|error| ControlTransportError::Io(error.to_string()))?;
        let response_line = read_client_line(&mut self.reader, AUTH_LINE_LIMIT)?;
        let response: AuthResponse = serde_json::from_str(&response_line)
            .map_err(|error| ControlTransportError::EndpointInvalid(error.to_string()))?;
        if response.protocol_version != CONTROL_PROTOCOL_VERSION {
            return Err(ControlTransportError::ProtocolMismatch {
                expected: CONTROL_PROTOCOL_VERSION,
                actual: response.protocol_version,
            });
        }
        if !response.ok {
            return Err(ControlTransportError::Unauthorized);
        }
        Ok(())
    }
}

fn handle_connection(
    stream: TcpStream,
    session: Arc<AgentControlSession>,
    token: String,
    stop: Arc<AtomicBool>,
) -> Result<(), ControlTransportError> {
    stream
        .set_read_timeout(Some(SOCKET_IO_TIMEOUT))
        .map_err(|error| ControlTransportError::Io(error.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| ControlTransportError::Io(error.to_string()))?;
    let mut writer = stream
        .try_clone()
        .map_err(|error| ControlTransportError::Io(error.to_string()))?;
    let mut reader = BufReader::new(stream);
    let auth = match read_server_line(&mut reader, AUTH_LINE_LIMIT, &stop)? {
        ServerLine::Stopped | ServerLine::Eof => return Ok(()),
        ServerLine::TooLarge => {
            write_auth_response(&mut writer, false, Some("auth_request_too_large"))?;
            return Ok(());
        }
        ServerLine::Line(line) => line,
    };
    let request: AuthRequest = match serde_json::from_str(&auth) {
        Ok(request) => request,
        Err(_) => {
            write_auth_response(&mut writer, false, Some("invalid_auth_request"))?;
            return Ok(());
        }
    };
    if request.protocol_version != CONTROL_PROTOCOL_VERSION {
        write_auth_response(&mut writer, false, Some("unsupported_protocol_version"))?;
        return Ok(());
    }
    if !constant_time_eq(request.token.as_bytes(), token.as_bytes()) {
        write_auth_response(&mut writer, false, Some("unauthorized"))?;
        return Ok(());
    }
    write_auth_response(&mut writer, true, None)?;

    loop {
        match read_server_line(&mut reader, REQUEST_LINE_LIMIT, &stop)? {
            ServerLine::Stopped | ServerLine::Eof => return Ok(()),
            ServerLine::TooLarge => {
                write_transport_error(
                    &mut writer,
                    "request_too_large",
                    "request line exceeds 64KiB",
                )?;
                return Ok(());
            }
            ServerLine::Line(line) => {
                let response = session.handle_line(&line);
                writer
                    .write_all(response.as_bytes())
                    .and_then(|_| writer.write_all(b"\n"))
                    .and_then(|_| writer.flush())
                    .map_err(|error| ControlTransportError::Io(error.to_string()))?;
            }
        }
    }
}

enum ServerLine {
    Line(String),
    TooLarge,
    Eof,
    Stopped,
}

fn read_server_line<R: BufRead>(
    reader: &mut R,
    limit: usize,
    stop: &AtomicBool,
) -> Result<ServerLine, ControlTransportError> {
    let mut bytes = Vec::new();
    loop {
        if stop.load(Ordering::SeqCst) {
            return Ok(ServerLine::Stopped);
        }
        let buffer = match reader.fill_buf() {
            Ok(buffer) => buffer,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(error) => return Err(ControlTransportError::Io(error.to_string())),
        };
        if buffer.is_empty() {
            return if bytes.is_empty() {
                Ok(ServerLine::Eof)
            } else {
                decode_line(bytes).map(ServerLine::Line)
            };
        }
        if let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            let take = index + 1;
            if bytes.len() + take > limit {
                reader.consume(take);
                return Ok(ServerLine::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..take]);
            reader.consume(take);
            return decode_line(bytes).map(ServerLine::Line);
        }
        if bytes.len() + buffer.len() > limit {
            let take = buffer.len();
            reader.consume(take);
            return Ok(ServerLine::TooLarge);
        }
        let take = buffer.len();
        bytes.extend_from_slice(buffer);
        reader.consume(take);
    }
}

fn read_client_line<R: BufRead>(
    reader: &mut R,
    limit: usize,
) -> Result<String, ControlTransportError> {
    let mut bytes = Vec::new();
    let mut limited = reader.take((limit + 1) as u64);
    let count = limited
        .read_until(b'\n', &mut bytes)
        .map_err(|error| ControlTransportError::Io(error.to_string()))?;
    if count == 0 {
        return Err(ControlTransportError::Eof);
    }
    if count > limit {
        return Err(ControlTransportError::ResponseTooLarge);
    }
    decode_line(bytes)
}

fn decode_line(mut bytes: Vec<u8>) -> Result<String, ControlTransportError> {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    String::from_utf8(bytes).map_err(|error| ControlTransportError::Io(error.to_string()))
}

fn write_auth_response(
    writer: &mut TcpStream,
    ok: bool,
    error: Option<&str>,
) -> Result<(), ControlTransportError> {
    let response = AuthResponse {
        kind: AuthKind::AgentControlAuth,
        protocol_version: CONTROL_PROTOCOL_VERSION,
        ok,
        error: error.map(str::to_owned),
    };
    write_json_line(writer, &response)
}

fn write_transport_error(
    writer: &mut TcpStream,
    code: &'static str,
    message: &str,
) -> Result<(), ControlTransportError> {
    let response = error_response(None, code, message.into());
    write_json_line(writer, &response)
}

fn write_json_line<T: Serialize>(
    writer: &mut TcpStream,
    value: &T,
) -> Result<(), ControlTransportError> {
    serde_json::to_writer(&mut *writer, value)
        .map_err(|error| ControlTransportError::Io(error.to_string()))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|error| ControlTransportError::Io(error.to_string()))
}
