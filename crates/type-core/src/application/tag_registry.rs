use crate::{domain::tag_registry::TagRegistry, ports::tag_registry::TagRegistryRepository};
pub struct TagRegistryService<R>(pub R);
impl<R: TagRegistryRepository> TagRegistryService<R> {
    pub fn read(&self) -> Result<TagRegistry, String> {
        self.0.read()
    }
    pub fn write(&self, registry: TagRegistry) -> Result<(), String> {
        registry.validate()?;
        self.0.write(&registry)
    }
}
