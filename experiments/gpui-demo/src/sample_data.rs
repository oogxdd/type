use gpui_kit::component::tree::TreeItem;

pub struct SampleNote {
    pub id: String,
    pub title: String,
    pub body: String,
}

pub fn samples() -> (Vec<TreeItem>, Vec<SampleNote>) {
    let mut notes = vec![
        sample(
            "welcome",
            "Start here",
            include_str!("../samples/welcome.md"),
        ),
        sample(
            "ui",
            "UI exploration",
            "A small native playground for typing and focusing panes.\n\n#todo Try moving this note into another folder.\n\n::: #idea\nWrite ordinary text here.\nTags can cover more than one line.\n\nA blank line stays inside the tagged block.\n:::\n",
        ),
        sample(
            "tree",
            "Tree interactions",
            "Drag notes and folders to move them.\n\nDrop near a row's top or bottom edge to reorder. Drop in the middle of a folder row to put the item inside it. Drop on the footer to move to the root.\n\n#todo Try moving a folder with all its descendants.\n\nA folder cannot move into itself or its own descendants.\n",
        ),
        sample(
            "editor",
            "Editor checklist",
            "Try typing, selection, copy/paste, undo and redo.\n\n#todo Type a few paragraphs.\n\n#idea Switch notes and return to the same cursor.\n\n::: #work\nSelect several lines.\nChoose Tag block and a tag from the toolbar.\nChange its name directly in the opening fence.\n:::\n\nOrdinary mid-line #hashtags stay plain text.\n",
        ),
        sample(
            "ru",
            "Заметка на русском",
            "Здесь можно проверить ввод кириллицы и переключение фокуса.\n\n#todo Написать пару предложений и вернуться сюда после переключения.\n\n::: #идея\nТег на несколько строк.\nВ этом блоке можно писать обычный текст.\n\nИ ещё один абзац в том же блоке.\n:::\n\nТекст, курсор и undo остаются в памяти. 🌿 📝\n",
        ),
        sample(
            "week",
            "Weekly plan",
            "Monday\nSketch the navigation.\n\n#todo Tuesday: try the native editor.\n\n::: #work\nWednesday: move notes and folders.\nThursday: evaluate tagged text.\n:::\n",
        ),
        sample(
            "scratch",
            "Scratchpad",
            "Write anything here.\n\n#todo A line tag.\n\n::: #idea\nA block tag.\nAnother line in the same block.\n:::\n",
        ),
    ];
    let mut long = String::from("A synthetic long document for scrolling and typing.\n\n");
    for index in 1..=200 {
        long.push_str(&format!("Section {index}\n\n#todo This is synthetic paragraph {index}. Try editing near the beginning, middle and end.\n\n::: #idea\nFirst idea\nSecond idea\n:::\n\n"));
    }
    notes.push(sample("long", "Long document · 1,800 lines", &long));
    let stress_rows = (1..=1000).map(|index| {
        let id = format!("stress-{index}");
        let title = format!("Sample note {index:04}");
        notes.push(sample(&id, &title, &format!("{title}\n\nSynthetic note {index} in a large folder.\n\nTry moving between rows with the keyboard.\n")));
        TreeItem::new(id, title)
    }).collect::<Vec<_>>();
    let roots = vec![
        TreeItem::new("welcome", "Start here"),
        TreeItem::new("projects", "Projects").expanded(true).child(
            TreeItem::new("native-ui", "Native UI")
                .expanded(true)
                .child(TreeItem::new("ui", "UI exploration"))
                .child(
                    TreeItem::new("components", "Components")
                        .expanded(true)
                        .child(TreeItem::new("tree", "Tree interactions"))
                        .child(TreeItem::new("editor", "Editor checklist")),
                ),
        ),
        TreeItem::new("personal", "Personal")
            .expanded(true)
            .child(TreeItem::new("ru", "Заметка на русском"))
            .child(
                TreeItem::new("planning", "Planning").child(TreeItem::new("week", "Weekly plan")),
            ),
        TreeItem::new("playground", "Playground")
            .expanded(true)
            .child(TreeItem::new("scratch", "Scratchpad"))
            .child(TreeItem::new("long", "Long document · 1,800 lines"))
            .child(TreeItem::new("stress", "1,000 sample notes").children(stress_rows)),
    ];
    (roots, notes)
}

fn sample(id: &str, title: &str, body: &str) -> SampleNote {
    SampleNote {
        id: id.into(),
        title: title.into(),
        body: format!(
            "---\nid: demo-{id}\ncreated: 2026-09-30T12:00:00Z\ncustom_field: preserved-verbatim\n---\n{body}"
        ),
    }
}
