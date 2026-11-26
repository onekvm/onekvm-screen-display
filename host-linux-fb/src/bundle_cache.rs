//! Bounded recently-used payloads; active users retain their own Arc independently.
use std::{collections::VecDeque, sync::Arc};

pub struct BundleCache<T> {
    entries: VecDeque<(String, Arc<T>, usize)>,
    max_entries: usize,
    max_bytes: usize,
    bytes: usize,
}

impl<T> BundleCache<T> {
    pub fn values(&self) -> impl Iterator<Item = &T> {
        self.entries.iter().map(|(_, value, _)| value.as_ref())
    }

    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            max_entries,
            max_bytes,
            bytes: 0,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<Arc<T>> {
        let index = self.entries.iter().position(|entry| entry.0 == key)?;
        let entry = self.entries.remove(index)?;
        let value = entry.1.clone();
        self.entries.push_back(entry);
        Some(value)
    }

    pub fn retain(&mut self, mut keep: impl FnMut(&str, &T) -> bool) {
        self.entries.retain(|(key, value, _)| keep(key, value));
        self.bytes = self.entries.iter().map(|entry| entry.2).sum();
    }

    pub fn insert(&mut self, key: String, value: Arc<T>, bytes: usize) {
        self.retain(|known, _| known != key);
        if self.max_entries == 0 || bytes > self.max_bytes {
            return;
        }
        while self.entries.len() >= self.max_entries || self.bytes > self.max_bytes - bytes {
            let Some((_, _, old_bytes)) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= old_bytes;
        }
        self.bytes += bytes;
        self.entries.push_back((key, value, bytes));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recent_hits_survive_and_evicted_active_users_remain_valid() {
        let mut cache = BundleCache::new(2, 10);
        let active = Arc::new(1);
        let weak = Arc::downgrade(&active);
        cache.insert("a".into(), active.clone(), 4);
        cache.insert("b".into(), Arc::new(2), 4);
        assert_eq!(*cache.get("a").unwrap(), 1);
        cache.insert("c".into(), Arc::new(3), 4);
        assert!(cache.get("b").is_none());
        cache.insert("d".into(), Arc::new(4), 7);
        assert!(cache.get("a").is_none());
        assert_eq!(*active, 1);
        drop(active);
        assert!(weak.upgrade().is_none());
        assert_eq!(cache.bytes, 7);
    }
    #[test]
    fn oversized_payloads_are_not_retained_and_revisions_can_be_pruned() {
        let mut cache = BundleCache::new(2, 10);
        let large = Arc::new(1);
        cache.insert("large".into(), large.clone(), 11);
        assert_eq!(Arc::strong_count(&large), 1);
        cache.insert("old".into(), Arc::new(1), 5);
        cache.insert("new".into(), Arc::new(2), 5);
        cache.retain(|_, revision| *revision == 2);
        assert!(cache.get("old").is_none());
        assert_eq!(cache.bytes, 5);
        cache.insert("new".into(), Arc::new(3), 3);
        assert_eq!(cache.bytes, 3);
        assert_eq!(*cache.get("new").unwrap(), 3);
    }
}
