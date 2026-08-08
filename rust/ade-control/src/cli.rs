use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlCliOptions {
    pub json: bool,
    pub jsonl: bool,
    pub state_db: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlCliError {
    MissingJsonMode,
    MissingJsonlMode,
    MissingStateDb,
    MissingStateDbPath,
    DuplicateArgument(String),
    UnexpectedArgument(String),
    Session(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<ControlCliOptions, ControlCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut jsonl = false;
    let mut state_db = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" if !json => json = true,
            "--json" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--jsonl" if !jsonl => jsonl = true,
            "--jsonl" => return Err(ControlCliError::DuplicateArgument(argument)),
            "--state-db" if state_db.is_none() => {
                let path = args.next().ok_or(ControlCliError::MissingStateDbPath)?;
                if path.trim().is_empty() {
                    return Err(ControlCliError::MissingStateDbPath);
                }
                state_db = Some(PathBuf::from(path));
            }
            "--state-db" => return Err(ControlCliError::DuplicateArgument(argument)),
            _ => return Err(ControlCliError::UnexpectedArgument(argument)),
        }
    }
    if !json {
        return Err(ControlCliError::MissingJsonMode);
    }
    if !jsonl {
        return Err(ControlCliError::MissingJsonlMode);
    }
    let state_db = state_db.ok_or(ControlCliError::MissingStateDb)?;
    Ok(ControlCliOptions {
        json,
        jsonl,
        state_db,
    })
}
