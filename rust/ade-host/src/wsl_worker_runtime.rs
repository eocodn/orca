use crate::file_git_router::{
    FileGitRouterError, FileGitWorkerTransport, JsonlFileGitWorkerTransport,
};
use crate::pty_router::{JsonlWorkerTransport, PtyWorkerTransport, RouterError};
use crate::pty_service::{PtyHostService, PtyHostServiceError};
use ade_host_core::protocol::{
    FileWorkerRequest, FileWorkerResponse, GitWorkerRequest, GitWorkerResponse, PtyRequest,
    PtyResponse,
};
use ade_host_platform::wsl_worker_endpoint::{WslWorkerEndpoint, WslWorkerEndpointError};
use ade_host_platform::wsl_worker_installer::{WslWorkerInstallRequest, WslWorkerInstaller};
use ade_host_platform::wsl_worker_supervisor::{
    WslWorkerSnapshot, WslWorkerStatus, WslWorkerSupervisor,
};
use ade_host_platform::wsl_worker_update::{WslWorkerUpdateCoordinator, WslWorkerUpdateFailure};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveWslWorkerEndpoint {
    pub generation: u64,
    pub endpoint: WslWorkerEndpoint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerRuntimeStatus {
    pub supervisor: WslWorkerSnapshot,
    pub active: Option<ActiveWslWorkerEndpoint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WslWorkerRuntimeError {
    Validate(String),
    Update(WslWorkerUpdateFailure),
    Endpoint(WslWorkerEndpointError),
    NotReady(String),
    FileGit(FileGitRouterError),
    Pty(PtyHostServiceError),
    LockPoisoned(&'static str),
}

pub struct WslWorkerRuntime {
    coordinator: WslWorkerUpdateCoordinator,
    supervisor: Arc<Mutex<WslWorkerSupervisor>>,
    active: Mutex<Option<ActiveWslWorkerEndpoint>>,
    admission: Arc<RwLock<()>>,
}

impl WslWorkerRuntime {
    pub fn new(supervisor: WslWorkerSupervisor, installer: WslWorkerInstaller) -> Self {
        let coordinator = WslWorkerUpdateCoordinator::new(supervisor, installer);
        let supervisor = coordinator.supervisor_handle();
        Self {
            coordinator,
            supervisor,
            active: Mutex::new(None),
            admission: Arc::new(RwLock::new(())),
        }
    }

    pub fn update(
        &self,
        request: &WslWorkerInstallRequest,
    ) -> Result<WslWorkerRuntimeStatus, WslWorkerRuntimeError> {
        WslWorkerInstaller::validate_request(request)
            .map_err(|failure| WslWorkerRuntimeError::Validate(failure.reason))?;
        let _write = self
            .admission
            .write()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("admission"))?;
        *self
            .active
            .lock()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("active"))? = None;
        let supervisor = self
            .coordinator
            .update(request)
            .map_err(WslWorkerRuntimeError::Update)?;
        let endpoint = WslWorkerEndpoint::new(
            request.distro.clone(),
            request.service_user.clone(),
            request.worker_id.clone(),
            request.worker_incarnation,
            request.worker_version.clone(),
        )
        .map_err(WslWorkerRuntimeError::Endpoint)?;
        let active = ActiveWslWorkerEndpoint {
            generation: supervisor.generation,
            endpoint,
        };
        *self
            .active
            .lock()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("active"))? = Some(active.clone());
        Ok(WslWorkerRuntimeStatus {
            supervisor,
            active: Some(active),
        })
    }

    pub fn status(&self) -> Result<WslWorkerRuntimeStatus, WslWorkerRuntimeError> {
        let supervisor = self
            .coordinator
            .snapshot()
            .map_err(WslWorkerRuntimeError::Update)?;
        let active = self
            .active
            .lock()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("active"))?
            .clone();
        Ok(WslWorkerRuntimeStatus { supervisor, active })
    }

    pub fn spawn_file_git(
        &self,
        timeout: Duration,
    ) -> Result<Box<dyn FileGitWorkerTransport>, WslWorkerRuntimeError> {
        let _read = self
            .admission
            .read()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("admission"))?;
        let active = self.ready_active()?;
        let transport = JsonlFileGitWorkerTransport::spawn_wsl(active.endpoint.clone(), timeout)
            .map_err(WslWorkerRuntimeError::FileGit)?;
        ensure_ready(&self.supervisor, &active).map_err(WslWorkerRuntimeError::NotReady)?;
        Ok(Box::new(FencedFileGitTransport::new(
            Box::new(transport),
            active,
            Arc::clone(&self.supervisor),
            Arc::clone(&self.admission),
        )))
    }

    pub fn spawn_pty_service(
        &self,
        timeout: Duration,
    ) -> Result<PtyHostService, WslWorkerRuntimeError> {
        let _read = self
            .admission
            .read()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("admission"))?;
        let active = self.ready_active()?;
        let transport = JsonlWorkerTransport::spawn_wsl(active.endpoint.clone(), timeout)
            .map_err(|error| WslWorkerRuntimeError::Pty(PtyHostServiceError::Router(error)))?;
        ensure_ready(&self.supervisor, &active).map_err(WslWorkerRuntimeError::NotReady)?;
        PtyHostService::new(Box::new(FencedPtyTransport::new(
            Box::new(transport),
            active,
            Arc::clone(&self.supervisor),
            Arc::clone(&self.admission),
        )))
        .map_err(WslWorkerRuntimeError::Pty)
    }

    fn ready_active(&self) -> Result<ActiveWslWorkerEndpoint, WslWorkerRuntimeError> {
        let active = self
            .active
            .lock()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("active"))?
            .clone()
            .ok_or_else(|| WslWorkerRuntimeError::NotReady("active_endpoint_missing".into()))?;
        ensure_ready(&self.supervisor, &active).map_err(WslWorkerRuntimeError::NotReady)?;
        Ok(active)
    }

    #[cfg(test)]
    pub(crate) fn fence_file_git_for_test(
        &self,
        transport: Box<dyn FileGitWorkerTransport>,
    ) -> Result<Box<dyn FileGitWorkerTransport>, WslWorkerRuntimeError> {
        let active = self.ready_active()?;
        Ok(Box::new(FencedFileGitTransport::new(
            transport,
            active,
            Arc::clone(&self.supervisor),
            Arc::clone(&self.admission),
        )))
    }

    #[cfg(test)]
    pub(crate) fn fence_pty_for_test(
        &self,
        transport: Box<dyn PtyWorkerTransport>,
    ) -> Result<Box<dyn PtyWorkerTransport>, WslWorkerRuntimeError> {
        let active = self.ready_active()?;
        Ok(Box::new(FencedPtyTransport::new(
            transport,
            active,
            Arc::clone(&self.supervisor),
            Arc::clone(&self.admission),
        )))
    }

    #[cfg(test)]
    pub(crate) fn set_maintenance_for_test(
        &self,
        maintenance: bool,
    ) -> Result<(), WslWorkerRuntimeError> {
        self.supervisor
            .lock()
            .map_err(|_| WslWorkerRuntimeError::LockPoisoned("supervisor"))?
            .set_maintenance(maintenance);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn try_update_write_gate_for_test(&self) -> bool {
        self.admission.try_write().is_ok()
    }
}

struct FencedFileGitTransport {
    inner: Box<dyn FileGitWorkerTransport>,
    active: ActiveWslWorkerEndpoint,
    supervisor: Arc<Mutex<WslWorkerSupervisor>>,
    admission: Arc<RwLock<()>>,
}

impl FencedFileGitTransport {
    fn new(
        inner: Box<dyn FileGitWorkerTransport>,
        active: ActiveWslWorkerEndpoint,
        supervisor: Arc<Mutex<WslWorkerSupervisor>>,
        admission: Arc<RwLock<()>>,
    ) -> Self {
        Self {
            inner,
            active,
            supervisor,
            admission,
        }
    }

    fn fence(&self) -> Result<(), FileGitRouterError> {
        if self.inner.identity().worker_id != self.active.endpoint.worker_id()
            || self.inner.identity().worker_incarnation != self.active.endpoint.worker_incarnation()
        {
            return Err(FileGitRouterError::Transport(
                "wsl_worker_fence:endpoint_mismatch".into(),
            ));
        }
        ensure_ready(&self.supervisor, &self.active)
            .map_err(|reason| FileGitRouterError::Transport(format!("wsl_worker_fence:{reason}")))
    }
}

impl FileGitWorkerTransport for FencedFileGitTransport {
    fn identity(&self) -> &crate::file_git_router::WorkerIdentity {
        self.inner.identity()
    }

    fn dispatch_file(
        &mut self,
        request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        let admission = Arc::clone(&self.admission);
        let _read = admission
            .read()
            .map_err(|_| FileGitRouterError::Transport("wsl_worker_fence:admission_lock".into()))?;
        self.fence()?;
        let response = self.inner.dispatch_file(request)?;
        self.fence()?;
        Ok(response)
    }

    fn dispatch_git(
        &mut self,
        request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        let admission = Arc::clone(&self.admission);
        let _read = admission
            .read()
            .map_err(|_| FileGitRouterError::Transport("wsl_worker_fence:admission_lock".into()))?;
        self.fence()?;
        let response = self.inner.dispatch_git(request)?;
        self.fence()?;
        Ok(response)
    }
}

struct FencedPtyTransport {
    inner: Box<dyn PtyWorkerTransport>,
    active: ActiveWslWorkerEndpoint,
    supervisor: Arc<Mutex<WslWorkerSupervisor>>,
    admission: Arc<RwLock<()>>,
}

impl FencedPtyTransport {
    fn new(
        inner: Box<dyn PtyWorkerTransport>,
        active: ActiveWslWorkerEndpoint,
        supervisor: Arc<Mutex<WslWorkerSupervisor>>,
        admission: Arc<RwLock<()>>,
    ) -> Self {
        Self {
            inner,
            active,
            supervisor,
            admission,
        }
    }

    fn fence(&self) -> Result<(), RouterError> {
        if self.inner.identity().worker_id != self.active.endpoint.worker_id()
            || self.inner.identity().worker_incarnation != self.active.endpoint.worker_incarnation()
        {
            return Err(RouterError::Transport(
                "wsl_worker_fence:endpoint_mismatch".into(),
            ));
        }
        ensure_ready(&self.supervisor, &self.active)
            .map_err(|reason| RouterError::Transport(format!("wsl_worker_fence:{reason}")))
    }
}

impl PtyWorkerTransport for FencedPtyTransport {
    fn identity(&self) -> &crate::pty_router::WorkerIdentity {
        self.inner.identity()
    }

    fn dispatch(&mut self, request: &PtyRequest) -> Result<PtyResponse, RouterError> {
        let admission = Arc::clone(&self.admission);
        let _read = admission
            .read()
            .map_err(|_| RouterError::Transport("wsl_worker_fence:admission_lock".into()))?;
        self.fence()?;
        let response = self.inner.dispatch(request)?;
        self.fence()?;
        Ok(response)
    }
}

fn ensure_ready(
    supervisor: &Arc<Mutex<WslWorkerSupervisor>>,
    active: &ActiveWslWorkerEndpoint,
) -> Result<(), String> {
    let snapshot = supervisor
        .lock()
        .map_err(|_| String::from("supervisor_lock"))?
        .snapshot();
    if snapshot.maintenance {
        return Err("maintenance".into());
    }
    if snapshot.generation != active.generation {
        return Err("stale_generation".into());
    }
    match snapshot.status {
        WslWorkerStatus::Ready {
            distro,
            worker_id,
            worker_incarnation,
        } if distro == active.endpoint.distro()
            && worker_id == active.endpoint.worker_id()
            && worker_incarnation == active.endpoint.worker_incarnation() =>
        {
            Ok(())
        }
        WslWorkerStatus::Ready { .. } => Err("endpoint_mismatch".into()),
        _ => Err("not_ready".into()),
    }
}
