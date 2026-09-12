use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TagDefinition {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub description: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TagRegistry {
    pub version: u32,
    pub tags: Vec<TagDefinition>,
}
impl Default for TagRegistry {
    fn default() -> Self {
        Self {
            version: 1,
            tags: Vec::new(),
        }
    }
}
pub fn valid_tag_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.chars().count() <= 80
        && chars.next().is_some_and(char::is_alphanumeric)
        && chars.all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '/' | '-'))
}
impl TagRegistry {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported tag registry version.".into());
        }
        let mut names = std::collections::HashSet::new();
        for tag in &self.tags {
            if !valid_tag_name(&tag.name)
                || tag.color.len() != 7
                || !tag.color.starts_with('#')
                || !tag.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Invalid tag name or color.".into());
            }
            if !names.insert(tag.name.to_lowercase()) {
                return Err("Duplicate tag name.".into());
            }
        }
        Ok(())
    }
}
