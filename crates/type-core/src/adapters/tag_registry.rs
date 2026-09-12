use crate::{domain::tag_registry::TagRegistry, ports::tag_registry::TagRegistryRepository};
use std::{fs, path::PathBuf};
pub const TAGS_REL_PATH: &str = ".type/tags.json";
pub struct FilesystemTagRegistry(pub PathBuf);
impl TagRegistryRepository for FilesystemTagRegistry {
    fn read(&self) -> Result<TagRegistry, String> {
        let raw = match fs::read_to_string(self.0.join(TAGS_REL_PATH)) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(TagRegistry::default())
            }
            Err(error) => return Err(error.to_string()),
        };
        let registry: TagRegistry = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        registry.validate()?;
        Ok(registry)
    }
    fn write(&self, registry: &TagRegistry) -> Result<(), String> {
        let path = self.0.join(TAGS_REL_PATH);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
        fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tag_registry::TagDefinition;
    #[test]
    fn registry_round_trip_and_validation() {
        let root = std::env::temp_dir().join(format!("type-tags-{}", uuid::Uuid::new_v4()));
        let repo = FilesystemTagRegistry(root.clone());
        assert_eq!(repo.read().unwrap(), TagRegistry::default());
        let registry = TagRegistry {
            version: 1,
            tags: vec![TagDefinition {
                name: "skip-ai".into(),
                color: "#8b5cf6".into(),
                description: "Private".into(),
            }],
        };
        repo.write(&registry).unwrap();
        assert_eq!(repo.read().unwrap(), registry);
        fs::write(root.join(TAGS_REL_PATH), "broken").unwrap();
        assert!(repo.read().is_err());
        let mut bad = registry;
        bad.tags[0].color = "red;position:fixed".into();
        assert!(bad.validate().is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
