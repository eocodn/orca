use crate::pty_registry::PtyWorkerRegistry;
use crate::worker_dispatch::{DispatchError, DispatchResponse, FileGitWorkerRegistry};
use ade_host_core::protocol::PtyRequest;
use serde::Serialize;
use std::io::{self, BufRead, Write};

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TransportError<'a> {
    ok: bool,
    request_id: Option<&'a str>,
    error: &'a str,
}

pub fn serve_jsonl<R: BufRead, W: Write>(
    reader: R,
    mut writer: W,
    registry: &PtyWorkerRegistry,
) -> io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let request_id = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|value| {
                value
                    .get("envelope")?
                    .get("request_id")?
                    .as_str()
                    .map(str::to_owned)
            });
        let output = match serde_json::from_str::<PtyRequest>(&line) {
            Ok(request) => match registry.execute(&request) {
                Ok(response) => {
                    serde_json::to_string(&response).expect("PtyResponse is serializable")
                }
                Err(error) => serde_json::to_string(&TransportError {
                    ok: false,
                    request_id: request_id.as_deref(),
                    error: &error,
                })
                .expect("transport error is serializable"),
            },
            Err(_error) => serde_json::to_string(&TransportError {
                ok: false,
                request_id: request_id.as_deref(),
                error: "invalid_request",
            })
            .expect("transport error is serializable"),
        };
        writer.write_all(output.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}

/// JSONL endpoint for strict File/Git worker requests. The envelope capability
/// is used only to select the typed decoder; each decoder still rejects
/// unknown fields and validates the full execution context.
pub fn serve_worker_jsonl<R: BufRead, W: Write>(
    reader: R,
    mut writer: W,
    registry: &FileGitWorkerRegistry,
) -> io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let request_id = request_id_from_line(&line);
        let output = match dispatch_worker_line(&line, registry) {
            Ok(response) => response.to_json().expect("worker response is serializable"),
            Err(error) => serde_json::to_string(&DispatchError {
                ok: false,
                request_id: request_id.as_deref(),
                error: &error,
            })
            .expect("worker error is serializable"),
        };
        writer.write_all(output.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}

/// Combined Agent Control endpoint used by the executable. PTY and File/Git
/// requests share one JSONL stream while retaining independent registries.
pub fn serve_mixed_jsonl<R: BufRead, W: Write>(
    reader: R,
    mut writer: W,
    pty_registry: &PtyWorkerRegistry,
    file_git_registry: &FileGitWorkerRegistry,
) -> io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let request_id = request_id_from_line(&line);
        let capability = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|value| {
                value
                    .get("envelope")?
                    .get("capability")?
                    .as_str()
                    .map(str::to_owned)
            });
        let output = match capability.as_deref() {
            Some("file") | Some("git") => dispatch_worker_line(&line, file_git_registry)
                .and_then(|response| response.to_json().map_err(|_| "serialization_error".into())),
            Some("pty") => serde_json::from_str::<PtyRequest>(&line)
                .map_err(|_| "invalid_request".to_string())
                .and_then(|request| {
                    pty_registry.execute(&request).map(|response| {
                        serde_json::to_string(&response).expect("PtyResponse is serializable")
                    })
                }),
            Some(_) => Err("unsupported_capability".into()),
            _ => Err("invalid_request".into()),
        };
        let output = output.unwrap_or_else(|error| {
            serde_json::to_string(&DispatchError {
                ok: false,
                request_id: request_id.as_deref(),
                error: &error,
            })
            .expect("transport error is serializable")
        });
        writer.write_all(output.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}

fn dispatch_worker_line(
    line: &str,
    registry: &FileGitWorkerRegistry,
) -> Result<DispatchResponse, String> {
    let envelope = serde_json::from_str::<serde_json::Value>(line)
        .map_err(|_| "invalid_request".to_string())?
        .get("envelope")
        .cloned()
        .ok_or_else(|| "invalid_request".to_string())?;
    let capability = envelope
        .get("capability")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "invalid_request".to_string())?;
    match capability {
        "file" => {
            let request = serde_json::from_str(line).map_err(|_| "invalid_request".to_string())?;
            registry.execute_file(&request).map(DispatchResponse::File)
        }
        "git" => {
            let request = serde_json::from_str(line).map_err(|_| "invalid_request".to_string())?;
            registry.execute_git(&request).map(DispatchResponse::Git)
        }
        _ => Err("unsupported_capability".into()),
    }
}

fn request_id_from_line(line: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|value| {
            value
                .get("envelope")?
                .get("request_id")?
                .as_str()
                .map(str::to_owned)
        })
}
