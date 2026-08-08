use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlCliOptions {
    pub json: bool,
    pub mode: ControlCliMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlCliMode {
    Direct {
        state_db: PathBuf,
    },
    Serve {
        state_db: PathBuf,
        endpoint_file: PathBuf,
    },
    Connect {
        endpoint_file: PathBuf,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlCliError {
    MissingJsonMode,
    MissingJsonlMode,
    MissingStateDb,
    MissingStateDbPath,
    MissingEndpointFile,
    MissingEndpointFilePath,
    MissingConnectPath,
    DuplicateArgument(String),
    UnexpectedArgument(String),
    InvalidModeCombination,
    Session(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<ControlCliOptions, ControlCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut jsonl = false;
    let mut serve = false;
    let mut state_db = None;
    let mut endpoint_file = None;
    let mut connect = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" if !json => json = true,
            "--json" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--jsonl" if !jsonl => jsonl = true,
            "--jsonl" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--serve" if !serve => serve = true,
            "--serve" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--state-db" if state_db.is_none() => {
                let path = args.next().ok_or(ControlCliError::MissingStateDbPath)?;
                if path.trim().is_empty() {
                    return Err(ControlCliError::MissingStateDbPath);
                }
                state_db = Some(PathBuf::from(path));
            }
            "--state-db" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--endpoint-file" if endpoint_file.is_none() => {
                let path = args
                    .next()
                    .ok_or(ControlCliError::MissingEndpointFilePath)?;
                if path.trim().is_empty() {
                    return Err(ControlCliError::MissingEndpointFilePath);
                }
                endpoint_file = Some(PathBuf::from(path));
            }
            "--endpoint-file" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--connect" if connect.is_none() => {
                let path = args.next().ok_or(ControlCliError::MissingConnectPath)?;
                if path.trim().is_empty() {
                    return Err(ControlCliError::MissingConnectPath);
                }
                connect = Some(PathBuf::from(path));
            }
            "--connect" => return Err(ControlCliError::DuplicateArgument(argument)),
            _ => return Err(ControlCliError::UnexpectedArgument(argument)),
        }
    }
    if !json {
        return Err(ControlCliError::MissingJsonMode);
    }
    let mode = match (serve, connect, jsonl, state_db, endpoint_file) {
        (false, None, true, Some(state_db), None) => ControlCliMode::Direct { state_db },
        (true, None, false, Some(state_db), Some(endpoint_file)) => ControlCliMode::Serve {
            state_db,
            endpoint_file,
        },
        (false, Some(endpoint_file), true, None, None) => ControlCliMode::Connect { endpoint_file },
        (false, None, false, _, _) => return Err(ControlCliError::MissingJsonlMode),
        (true, None, false, Some(_), None) => return Err(ControlCliError::MissingEndpointFile),
        (false, None, true, None, None) => return Err(ControlCliError::MissingStateDb),
        _ => return Err(ControlCliError::InvalidModeCombination),
    };
    Ok(ControlCliOptions { json, mode })
}
