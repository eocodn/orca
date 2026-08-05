use crate::pty_registry::PtyWorkerRegistry;
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
