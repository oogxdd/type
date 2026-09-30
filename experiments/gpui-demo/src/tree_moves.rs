use gpui_kit::{SharedString, component::tree::TreeItem};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    Before,
    Inside,
    After,
    Root,
}

pub fn contains(items: &[TreeItem], id: &SharedString) -> bool {
    items
        .iter()
        .any(|item| item.id == *id || contains(&item.children, id))
}

pub fn can_move(items: &[TreeItem], source: &SharedString, target: &SharedString) -> bool {
    let Some(source_item) = find(items, source) else {
        return false;
    };
    source != target && find(items, target).is_some() && !contains(&source_item.children, target)
}

pub fn move_item(
    items: &mut Vec<TreeItem>,
    source: &SharedString,
    target: Option<&SharedString>,
    placement: Placement,
) -> bool {
    if let Some(target) = target {
        if !can_move(items, source, target) {
            return false;
        }
    } else if placement != Placement::Root {
        return false;
    }
    let Some(item) = remove(items, source) else {
        return false;
    };
    if let Some(target) = target {
        // The target was validated before removing anything; identifiers are unique.
        insert(items, target, item, placement);
    } else {
        items.push(item);
    }
    true
}

fn find<'a>(items: &'a [TreeItem], id: &SharedString) -> Option<&'a TreeItem> {
    for item in items {
        if item.id == *id {
            return Some(item);
        }
        if let Some(found) = find(&item.children, id) {
            return Some(found);
        }
    }
    None
}

fn remove(items: &mut Vec<TreeItem>, id: &SharedString) -> Option<TreeItem> {
    if let Some(index) = items.iter().position(|item| item.id == *id) {
        return Some(items.remove(index));
    }
    items
        .iter_mut()
        .find_map(|item| remove(&mut item.children, id))
}

fn insert(
    items: &mut Vec<TreeItem>,
    target: &SharedString,
    item: TreeItem,
    placement: Placement,
) -> bool {
    if let Some(index) = items.iter().position(|entry| entry.id == *target) {
        match placement {
            Placement::Inside => items[index].children.push(item),
            Placement::Before => items.insert(index, item),
            Placement::After => items.insert(index + 1, item),
            Placement::Root => unreachable!(),
        }
        return true;
    }
    for parent in items {
        if contains(&parent.children, target) {
            return insert(&mut parent.children, target, item, placement);
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<TreeItem> {
        vec![
            TreeItem::new("folder", "Folder").child(
                TreeItem::new("child-folder", "Child folder").child(TreeItem::new("note", "Note")),
            ),
            TreeItem::new("other", "Other").child(TreeItem::new("second", "Second")),
        ]
    }

    #[test]
    fn rejects_self_descendant_and_missing_target_without_removing_source() {
        let mut items = fixture();
        for target in ["folder", "child-folder", "note", "missing"] {
            assert!(!move_item(
                &mut items,
                &"folder".into(),
                Some(&target.into()),
                Placement::Inside
            ));
            assert!(contains(&items, &"note".into()));
            assert_eq!(items.len(), 2);
        }
    }

    #[test]
    fn moves_folder_with_subtree_and_reorders_notes() {
        let mut items = fixture();
        assert!(move_item(
            &mut items,
            &"child-folder".into(),
            Some(&"other".into()),
            Placement::Inside
        ));
        assert!(items[0].children.is_empty());
        assert_eq!(items[1].children[1].children[0].id.as_str(), "note");
        assert!(move_item(
            &mut items,
            &"note".into(),
            Some(&"second".into()),
            Placement::Before
        ));
        assert_eq!(items[1].children[0].id.as_str(), "note");
        assert!(move_item(&mut items, &"note".into(), None, Placement::Root));
        assert_eq!(items[2].id.as_str(), "note");
    }
}
