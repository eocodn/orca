use crate::protocol::CONTROL_PROTOCOL_VERSION;
use crate::transport::ControlTransportError;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlEndpointFile {
    pub(crate) protocol_version: u16,
    pub(crate) address: String,
    pub(crate) token: String,
    pub(crate) server_pid: u32,
}

pub(crate) struct EndpointRegistration {
    pub(crate) path: PathBuf,
    pub(crate) token: String,
}

impl Drop for EndpointRegistration {
    fn drop(&mut self) {
        let Ok(endpoint) = read_endpoint_file(&self.path) else {
            return;
        };
        if constant_time_eq(endpoint.token.as_bytes(), self.token.as_bytes()) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(crate) fn validate_endpoint(
    endpoint: &ControlEndpointFile,
) -> Result<(), ControlTransportError> {
    if endpoint.protocol_version != CONTROL_PROTOCOL_VERSION {
        return Err(ControlTransportError::ProtocolMismatch {
            expected: CONTROL_PROTOCOL_VERSION,
            actual: endpoint.protocol_version,
        });
    }
    let address: SocketAddr = endpoint
        .address
        .parse()
        .map_err(|error| ControlTransportError::EndpointInvalid(format!("address:{error}")))?;
    if !address.ip().is_loopback() {
        return Err(ControlTransportError::EndpointInvalid(
            "address_is_not_loopback".into(),
        ));
    }
    if endpoint.token.len() != 64 || !endpoint.token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ControlTransportError::EndpointInvalid(
            "invalid_token".into(),
        ));
    }
    Ok(())
}

pub(crate) fn read_endpoint_file(
    path: &Path,
) -> Result<ControlEndpointFile, ControlTransportError> {
    let bytes =
        fs::read(path).map_err(|error| ControlTransportError::EndpointRead(error.to_string()))?;
    let endpoint: ControlEndpointFile = serde_json::from_slice(&bytes)
        .map_err(|error| ControlTransportError::EndpointInvalid(error.to_string()))?;
    validate_endpoint(&endpoint)?;
    Ok(endpoint)
}

pub(crate) fn write_endpoint_file(
    path: &Path,
    endpoint: &ControlEndpointFile,
) -> Result<(), ControlTransportError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ControlTransportError::EndpointWrite("invalid_endpoint_filename".into()))?;
    let temp = path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        endpoint.server_pid,
        &endpoint.token[..8]
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = publish_endpoint_temp(&mut options, &temp, path, endpoint);
    let _ = fs::remove_file(&temp);
    result
}

fn publish_endpoint_temp(
    options: &mut OpenOptions,
    temp: &Path,
    path: &Path,
    endpoint: &ControlEndpointFile,
) -> Result<(), ControlTransportError> {
    let mut file = options
        .open(temp)
        .map_err(|error| ControlTransportError::EndpointWrite(error.to_string()))?;
    serde_json::to_writer(&mut file, endpoint)
        .map_err(|error| ControlTransportError::EndpointWrite(error.to_string()))?;
    file.write_all(b"\n")
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|error| ControlTransportError::EndpointWrite(error.to_string()))?;
    fs::hard_link(temp, path).map_err(|error| {
        if fs::symlink_metadata(path).is_ok() {
            ControlTransportError::EndpointFileExists(path.to_path_buf())
        } else {
            ControlTransportError::EndpointWrite(error.to_string())
        }
    })
}

pub(crate) fn generate_token() -> Result<String, ControlTransportError> {
    let mut bytes = [0u8; 32];
    fill_os_random(&mut bytes)?;
    let mut token = String::with_capacity(64);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut token, "{byte:02x}")
            .map_err(|error| ControlTransportError::Entropy(error.to_string()))?;
    }
    Ok(token)
}

#[cfg(unix)]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), ControlTransportError> {
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(bytes))
        .map_err(|error| ControlTransportError::Entropy(error.to_string()))
}

#[cfg(windows)]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), ControlTransportError> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(ControlTransportError::Entropy(format!(
            "BCryptGenRandom status={status}"
        )))
    }
}

#[cfg(not(any(unix, windows)))]
fn fill_os_random(_bytes: &mut [u8]) -> Result<(), ControlTransportError> {
    Err(ControlTransportError::Entropy(
        "unsupported entropy platform".into(),
    ))
}

pub(crate) fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}
