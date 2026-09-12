use crate::domain::tag_registry::TagRegistry;
/// Advisory colors and descriptions for the active working folder; names in notes remain authoritative.
pub trait TagRegistryRepository {
    fn read(&self) -> Result<TagRegistry, String>;
    fn write(&self, registry: &TagRegistry) -> Result<(), String>;
}
