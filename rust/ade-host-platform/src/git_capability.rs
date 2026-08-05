#[cfg(test)]
mod contract_tests {
    use super::{
        GitCapability, GitCapabilityCache, GitCapabilityHost, GitCapabilityRegistry,
        GitCapabilityState,
    };
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn retries_unsupported_git_capabilities_only_after_the_retry_window() {
        let cache = GitCapabilityCache::new();

        assert!(cache.should_try(GitCapability::WorktreeListZ, 100).unwrap());
        cache
            .remember_unsupported(GitCapability::WorktreeListZ, 100)
            .unwrap();
        assert!(!cache
            .should_try(GitCapability::WorktreeListZ, 100 + 1)
            .unwrap());
        assert!(cache
            .should_try(GitCapability::WorktreeListZ, 100 + 30 * 60 * 1_000)
            .unwrap());
        assert_eq!(
            cache
                .observe(GitCapability::WorktreeListZ, 100 + 1)
                .unwrap()
                .state,
            GitCapabilityState::Unsupported
        );
    }

    #[test]
    fn isolates_capability_records_by_capability() {
        let cache = GitCapabilityCache::new();
        cache
            .remember_unsupported(GitCapability::WorktreeListZ, 100)
            .unwrap();

        assert_eq!(
            cache
                .observe(GitCapability::WorktreeListZ, 101)
                .unwrap()
                .state,
            GitCapabilityState::Unsupported
        );
        assert_eq!(
            cache
                .observe(GitCapability::MergeTreeMergeBase, 101)
                .unwrap()
                .state,
            GitCapabilityState::Unknown
        );
    }

    #[test]
    fn concurrent_unsupported_probes_share_one_authoritative_result() {
        let cache = Arc::new(GitCapabilityCache::new());
        let preferred_calls = Arc::new(Mutex::new(0));
        let handles = (0..8)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let preferred_calls = Arc::clone(&preferred_calls);
                thread::spawn(move || {
                    cache.run_with_fallback_at(
                        GitCapability::ForEachRefExclude,
                        100,
                        || {
                            *preferred_calls.lock().unwrap() += 1;
                            thread::sleep(Duration::from_millis(20));
                            Err::<String, _>(String::from("unsupported option"))
                        },
                        || Ok::<String, String>(String::from("fallback")),
                        |error| error.contains("unsupported"),
                    )
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(preferred_calls.lock().unwrap().to_owned(), 1);
        assert_eq!(results, vec![String::from("fallback"); 8]);
    }

    #[test]
    fn successful_probe_is_cached_but_new_unsupported_errors_invalidate_it() {
        let cache = GitCapabilityCache::new();
        let supported = cache
            .run_with_fallback_at(
                GitCapability::MergeTreeWriteTree,
                100,
                || Ok::<String, String>(String::from("preferred")),
                || Ok::<String, String>(String::from("fallback")),
                |error| error.contains("unsupported"),
            )
            .unwrap();
        assert_eq!(supported, "preferred");
        assert_eq!(
            cache
                .observe(GitCapability::MergeTreeWriteTree, 101)
                .unwrap()
                .state,
            GitCapabilityState::Supported
        );

        let fallback = cache
            .run_with_fallback_at(
                GitCapability::MergeTreeWriteTree,
                101,
                || Err::<String, _>(String::from("unsupported option")),
                || Ok::<String, String>(String::from("fallback")),
                |error| error.contains("unsupported"),
            )
            .unwrap();
        assert_eq!(fallback, "fallback");
        assert_eq!(
            cache
                .observe(GitCapability::MergeTreeWriteTree, 102)
                .unwrap()
                .state,
            GitCapabilityState::Unsupported
        );
    }

    #[test]
    fn scopes_capability_state_to_native_wsl_and_ssh_hosts() {
        let registry = GitCapabilityRegistry::new();
        let capability = GitCapability::WorktreeListZ;
        let native = registry.cache_for(GitCapabilityHost::Native).unwrap();
        native.remember_unsupported(capability, 100).unwrap();

        assert_eq!(
            registry
                .cache_for(GitCapabilityHost::Native)
                .unwrap()
                .observe(capability, 101)
                .unwrap()
                .state,
            GitCapabilityState::Unsupported
        );
        assert_eq!(
            registry
                .cache_for(GitCapabilityHost::Wsl2 {
                    distro: String::from("Ubuntu")
                })
                .unwrap()
                .observe(capability, 101)
                .unwrap()
                .state,
            GitCapabilityState::Unknown
        );
        assert_eq!(
            registry
                .cache_for(GitCapabilityHost::Ssh {
                    host: String::from("build.example")
                })
                .unwrap()
                .observe(capability, 101)
                .unwrap()
                .state,
            GitCapabilityState::Unknown
        );
    }
}
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

pub const GIT_CAPABILITY_RETRY_INTERVAL_MS: u64 = 30 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GitCapability {
    #[serde(rename = "for-each-ref-exclude")]
    ForEachRefExclude,
    #[serde(rename = "merge-tree-merge-base")]
    MergeTreeMergeBase,
    #[serde(rename = "merge-tree-write-tree")]
    MergeTreeWriteTree,
    #[serde(rename = "rev-parse-path-format")]
    RevParsePathFormat,
    #[serde(rename = "worktree-list-z")]
    WorktreeListZ,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitCapabilityState {
    Unknown,
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCapabilityObservation {
    pub capability: GitCapability,
    pub state: GitCapabilityState,
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCapabilityCacheError {
    StateLockPoisoned,
    WaitLockPoisoned,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCapabilityRunError<E> {
    State(GitCapabilityCacheError),
    Preferred(E),
    Fallback(E),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GitCapabilityHost {
    Native,
    Wsl2 { distro: String },
    Ssh { host: String },
}

#[derive(Debug, Clone, Copy)]
struct CapabilityRecord {
    state: GitCapabilityState,
    retry_after_ms: Option<u64>,
}

#[derive(Debug, Default)]
struct CacheState {
    records: HashMap<GitCapability, CapabilityRecord>,
    probes: HashMap<GitCapability, ()>,
}

#[derive(Clone, Debug, Default)]
pub struct GitCapabilityCache {
    state: Arc<(Mutex<CacheState>, Condvar)>,
}

impl GitCapabilityCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn should_try(
        &self,
        capability: GitCapability,
        now_ms: u64,
    ) -> Result<bool, GitCapabilityCacheError> {
        let state = self.lock_state()?;
        Ok(match state.records.get(&capability) {
            Some(CapabilityRecord {
                state: GitCapabilityState::Supported,
                ..
            }) => true,
            Some(CapabilityRecord {
                state: GitCapabilityState::Unsupported,
                retry_after_ms: Some(retry_after_ms),
            }) => now_ms >= *retry_after_ms,
            _ => true,
        })
    }

    pub fn observe(
        &self,
        capability: GitCapability,
        now_ms: u64,
    ) -> Result<GitCapabilityObservation, GitCapabilityCacheError> {
        let state = self.lock_state()?;
        let record = state.records.get(&capability).copied();
        let (record_state, retry_after_ms) = match record {
            Some(CapabilityRecord {
                state: GitCapabilityState::Unsupported,
                retry_after_ms: Some(retry_after_ms),
            }) if now_ms < retry_after_ms => {
                (GitCapabilityState::Unsupported, Some(retry_after_ms))
            }
            Some(CapabilityRecord {
                state: GitCapabilityState::Supported,
                ..
            }) => (GitCapabilityState::Supported, None),
            _ => (GitCapabilityState::Unknown, None),
        };
        Ok(GitCapabilityObservation {
            capability,
            state: record_state,
            retry_after_ms,
        })
    }

    pub fn remember_unsupported(
        &self,
        capability: GitCapability,
        now_ms: u64,
    ) -> Result<(), GitCapabilityCacheError> {
        let mut state = self.lock_state()?;
        state.records.insert(
            capability,
            CapabilityRecord {
                state: GitCapabilityState::Unsupported,
                retry_after_ms: Some(now_ms.saturating_add(GIT_CAPABILITY_RETRY_INTERVAL_MS)),
            },
        );
        Ok(())
    }

    pub fn clear(&self) -> Result<(), GitCapabilityCacheError> {
        let mut state = self.lock_state()?;
        state.records.clear();
        Ok(())
    }

    pub fn run_with_fallback<T, E, P, F, U>(
        &self,
        capability: GitCapability,
        run_preferred: P,
        run_fallback: F,
        is_unsupported: U,
    ) -> Result<T, GitCapabilityRunError<E>>
    where
        P: Fn() -> Result<T, E>,
        F: Fn() -> Result<T, E>,
        U: Fn(&E) -> bool,
    {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default();
        self.run_with_fallback_at(
            capability,
            now_ms,
            run_preferred,
            run_fallback,
            is_unsupported,
        )
    }

    pub fn run_with_fallback_at<T, E, P, F, U>(
        &self,
        capability: GitCapability,
        now_ms: u64,
        run_preferred: P,
        run_fallback: F,
        is_unsupported: U,
    ) -> Result<T, GitCapabilityRunError<E>>
    where
        P: Fn() -> Result<T, E>,
        F: Fn() -> Result<T, E>,
        U: Fn(&E) -> bool,
    {
        loop {
            let (lock, condition) = &*self.state;
            let mut state = lock.lock().map_err(|_| {
                GitCapabilityRunError::State(GitCapabilityCacheError::StateLockPoisoned)
            })?;
            if let Some(record) = state.records.get(&capability).copied() {
                if record.state == GitCapabilityState::Supported {
                    drop(state);
                    return self.run_preferred_or_fallback(
                        capability,
                        now_ms,
                        &run_preferred,
                        &run_fallback,
                        &is_unsupported,
                    );
                }
                if record.state == GitCapabilityState::Unsupported
                    && record
                        .retry_after_ms
                        .is_some_and(|retry_after| now_ms < retry_after)
                {
                    drop(state);
                    return run_fallback().map_err(GitCapabilityRunError::Fallback);
                }
            }
            if state.probes.contains_key(&capability) {
                state = condition.wait(state).map_err(|_| {
                    GitCapabilityRunError::State(GitCapabilityCacheError::WaitLockPoisoned)
                })?;
                drop(state);
                continue;
            }
            state.probes.insert(capability, ());
            drop(state);
            break;
        }

        match run_preferred() {
            Ok(value) => {
                self.finish_probe(
                    capability,
                    Some(CapabilityRecord {
                        state: GitCapabilityState::Supported,
                        retry_after_ms: None,
                    }),
                )
                .map_err(GitCapabilityRunError::State)?;
                Ok(value)
            }
            Err(error) if is_unsupported(&error) => {
                self.finish_probe(
                    capability,
                    Some(CapabilityRecord {
                        state: GitCapabilityState::Unsupported,
                        retry_after_ms: Some(
                            now_ms.saturating_add(GIT_CAPABILITY_RETRY_INTERVAL_MS),
                        ),
                    }),
                )
                .map_err(GitCapabilityRunError::State)?;
                run_fallback().map_err(GitCapabilityRunError::Fallback)
            }
            Err(error) => {
                self.finish_probe(capability, None)
                    .map_err(GitCapabilityRunError::State)?;
                Err(GitCapabilityRunError::Preferred(error))
            }
        }
    }

    fn run_preferred_or_fallback<T, E, P, F, U>(
        &self,
        capability: GitCapability,
        now_ms: u64,
        run_preferred: &P,
        run_fallback: &F,
        is_unsupported: &U,
    ) -> Result<T, GitCapabilityRunError<E>>
    where
        P: Fn() -> Result<T, E>,
        F: Fn() -> Result<T, E>,
        U: Fn(&E) -> bool,
    {
        match run_preferred() {
            Ok(value) => Ok(value),
            Err(error) if is_unsupported(&error) => {
                self.remember_unsupported(capability, now_ms)
                    .map_err(GitCapabilityRunError::State)?;
                run_fallback().map_err(GitCapabilityRunError::Fallback)
            }
            Err(error) => Err(GitCapabilityRunError::Preferred(error)),
        }
    }

    fn finish_probe(
        &self,
        capability: GitCapability,
        record: Option<CapabilityRecord>,
    ) -> Result<(), GitCapabilityCacheError> {
        let (lock, condition) = &*self.state;
        let mut state = lock
            .lock()
            .map_err(|_| GitCapabilityCacheError::StateLockPoisoned)?;
        state.probes.remove(&capability);
        if let Some(record) = record {
            state.records.insert(capability, record);
        }
        condition.notify_all();
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, CacheState>, GitCapabilityCacheError> {
        self.state
            .0
            .lock()
            .map_err(|_| GitCapabilityCacheError::StateLockPoisoned)
    }
}

#[derive(Clone, Debug, Default)]
pub struct GitCapabilityRegistry {
    caches: Arc<Mutex<HashMap<GitCapabilityHost, GitCapabilityCache>>>,
}

impl GitCapabilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    // The identity key prevents a capability probe from crossing execution-host boundaries.
    pub fn cache_for(
        &self,
        host: GitCapabilityHost,
    ) -> Result<GitCapabilityCache, GitCapabilityCacheError> {
        let mut caches = self
            .caches
            .lock()
            .map_err(|_| GitCapabilityCacheError::StateLockPoisoned)?;
        Ok(caches
            .entry(host)
            .or_insert_with(GitCapabilityCache::new)
            .clone())
    }

    pub fn clear(&self) -> Result<(), GitCapabilityCacheError> {
        let mut caches = self
            .caches
            .lock()
            .map_err(|_| GitCapabilityCacheError::StateLockPoisoned)?;
        caches.clear();
        Ok(())
    }
}
