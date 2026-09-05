import { beforeEach, describe, expect, it } from "vitest";
import { splitBlock } from "@tiptap/pm/commands";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { executeVimCommand, type VimHost } from "./commands";
import { buildVimDoc } from "./flat-doc";
import { emptyPending, parseVimKey, type VimMode, type VimPending } from "./keys";
import { clearRegisters } from "./registers";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph+" },
    hardBreak: { inline: true, group: "inline", selectable: false },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
  },
});

const paragraphOf = (text: string) =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);

/**
 * A miniature editor that runs real key sequences through the parser and the
 * command layer. Geometry and Tiptap are stubbed; `j`/`k` move by logical line,
 * which is close enough for everything the commands themselves decide.
 */
const createEditor = (lines: string[]) => {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, lines.map(paragraphOf)),
  });

  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: ReturnType<typeof state.tr.setMeta>) => {
      state = state.apply(tr);
    },
    hasFocus: () => true,
  } as unknown as EditorView;

  let mode: VimMode = "normal";
  let visualAnchor: number | null = null;
  let visualHead: number | null = null;
  let pending: VimPending = emptyPending();

  const host: VimHost = {
    view,
    get mode() {
      return mode;
    },
    setMode: (next) => {
      mode = next;
    },
    get visualAnchor() {
      return visualAnchor;
    },
    setVisualAnchor: (index) => {
      visualAnchor = index;
    },
    get visualHead() {
      return visualHead;
    },
    setVisualHead: (index) => {
      visualHead = index;
    },
    lastVisual: null,
    setLastVisual: (value) => {
      host.lastVisual = value;
    },
    lastFind: null,
    setLastFind: (value) => {
      host.lastFind = value;
    },
    lastChange: null,
    setLastChange: (value) => {
      host.lastChange = value;
    },
    moveVisualLines: (direction, lineCount) => {
      const doc = buildVimDoc(state.doc);
      const index = doc.toIndex(state.selection.head);
      const current = doc.lineNumberAt(index);
      const column = index - doc.lines[current].flatStart;
      const target = Math.max(
        0,
        Math.min(doc.lines.length - 1, current + direction * lineCount)
      );
      const line = doc.lines[target];
      return Math.min(line.to, line.from + column);
    },
    halfPageLines: () => 5,
    scrollCursor: () => {},
    indentSelection: () => false,
    splitBlock: () => splitBlock(state, view.dispatch),
    undo: () => {},
    redo: () => {},
    closeHistoryPoint: () => {},
    beginInsertCapture: () => {},
  };

  const api = {
    host,
    get mode() {
      return mode;
    },
    text: () => buildVimDoc(state.doc).text,
    cursor: () => buildVimDoc(state.doc).toIndex(state.selection.head),
    /** Places the cursor at a (line, column) pair. */
    at: (line: number, column = 0) => {
      const doc = buildVimDoc(state.doc);
      const target = doc.lines[line];
      state = state.apply(
        state.tr.setSelection(
          TextSelection.near(
            state.doc.resolve(Math.min(target.to, target.from + column))
          )
        )
      );
      return api;
    },
    /** Types a key sequence, one character at a time. */
    type: (keys: string) => {
      for (const key of [...keys]) {
        const result = parseVimKey(pending, { key, char: key, ctrl: false }, mode);
        pending = result.pending;
        if (result.kind === "command") {
          executeVimCommand(result.command, host);
        }
      }
      return api;
    },
    /** Simulates Insert-mode typing, which the parser never sees. */
    insert: (value: string) => {
      state = state.apply(state.tr.insertText(value, state.selection.head));
      return api;
    },
  };
  return api;
};

beforeEach(() => {
  clearRegisters();
});

describe("linewise operators", () => {
  it("dd deletes the current line", () => {
    const editor = createEditor(["one", "two", "three"]).at(1).type("dd");
    expect(editor.text()).toBe("one\nthree");
    expect(editor.cursor()).toBe(4);
  });

  it("3dd deletes three lines", () => {
    const editor = createEditor(["a", "b", "c", "d"]).at(0).type("3dd");
    expect(editor.text()).toBe("d");
  });

  it("dd on the only line leaves an empty document", () => {
    const editor = createEditor(["only"]).at(0).type("dd");
    expect(editor.text()).toBe("");
  });

  it("dj deletes the line and the one below", () => {
    const editor = createEditor(["a", "b", "c"]).at(0).type("dj");
    expect(editor.text()).toBe("c");
  });

  it("dG deletes to the end of the document", () => {
    const editor = createEditor(["a", "b", "c"]).at(1).type("dG");
    expect(editor.text()).toBe("a");
  });

  it("dgg deletes to the start of the document", () => {
    const editor = createEditor(["a", "b", "c"]).at(1).type("dgg");
    expect(editor.text()).toBe("c");
  });

  it("cc empties the line and stays on it", () => {
    const editor = createEditor(["one", "two"]).at(0).type("cc");
    expect(editor.text()).toBe("\ntwo");
    expect(editor.mode).toBe("insert");
  });
});

describe("charwise operators", () => {
  it("dw deletes to the next word", () => {
    const editor = createEditor(["foo bar baz"]).at(0).type("dw");
    expect(editor.text()).toBe("bar baz");
  });

  it("dw stops at the end of the line", () => {
    const editor = createEditor(["foo bar", "next"]).at(0, 4).type("dw");
    expect(editor.text()).toBe("foo \nnext");
  });

  it("de keeps the trailing space", () => {
    const editor = createEditor(["foo bar"]).at(0).type("de");
    expect(editor.text()).toBe(" bar");
  });

  it("cw changes the word without its trailing space", () => {
    const editor = createEditor(["foo bar"]).at(0).type("cw");
    expect(editor.text()).toBe(" bar");
    expect(editor.mode).toBe("insert");
  });

  it("d$ deletes to the end of the line", () => {
    const editor = createEditor(["hello world"]).at(0, 5).type("d$");
    expect(editor.text()).toBe("hello");
  });

  it("df. is inclusive of the character it finds", () => {
    const editor = createEditor(["one. two"]).at(0).type("df.");
    expect(editor.text()).toBe(" two");
  });

  it("dt. stops one short", () => {
    const editor = createEditor(["one. two"]).at(0).type("dt.");
    expect(editor.text()).toBe(". two");
  });
});

describe("text objects", () => {
  it("diw deletes the word under the cursor", () => {
    const editor = createEditor(["the quick brown"]).at(0, 5).type("diw");
    expect(editor.text()).toBe("the  brown");
  });

  it("daw takes the trailing space too", () => {
    const editor = createEditor(["the quick brown"]).at(0, 5).type("daw");
    expect(editor.text()).toBe("the brown");
  });

  it("ci( changes inside the parentheses", () => {
    const editor = createEditor(["call(arg) end"]).at(0, 6).type("ci(");
    expect(editor.text()).toBe("call() end");
    expect(editor.mode).toBe("insert");
  });

  it('di" empties the quotes', () => {
    const editor = createEditor(['say "hi" now']).at(0, 6).type('di"');
    expect(editor.text()).toBe('say "" now');
  });

  it("dap deletes the paragraph and the blank line after it", () => {
    const editor = createEditor(["a", "b", "", "c"]).at(0).type("dap");
    expect(editor.text()).toBe("c");
  });

  it("dip keeps the blank line", () => {
    const editor = createEditor(["a", "b", "", "c"]).at(0).type("dip");
    expect(editor.text()).toBe("\nc");
  });
});

describe("yank, delete and paste", () => {
  it("yy then p puts the line below", () => {
    const editor = createEditor(["one", "two"]).at(0).type("yyp");
    expect(editor.text()).toBe("one\none\ntwo");
  });

  it("yy then P puts the line above", () => {
    const editor = createEditor(["one", "two"]).at(1).type("yyP");
    expect(editor.text()).toBe("one\ntwo\ntwo");
  });

  it("2p pastes twice", () => {
    const editor = createEditor(["one", "two"]).at(0).type("yy2p");
    expect(editor.text()).toBe("one\none\none\ntwo");
  });

  it("dd then p moves a line down", () => {
    const editor = createEditor(["one", "two"]).at(0).type("ddp");
    expect(editor.text()).toBe("two\none");
  });

  it("charwise yank pastes after the cursor", () => {
    const editor = createEditor(["ab"]).at(0).type("ylp");
    expect(editor.text()).toBe("aab");
  });

  it("named registers do not clobber each other", () => {
    const editor = createEditor(["one", "two"]).at(0).type('"ayy').at(1).type("yy");
    editor.at(1).type('"ap');
    expect(editor.text()).toBe("one\ntwo\none");
  });

  it("the black hole register discards the deletion", () => {
    const editor = createEditor(["one", "two"]).at(0).type("yy").at(1).type('"_dd');
    editor.type("p");
    expect(editor.text()).toBe("one\none");
  });
});

describe("single-key edits", () => {
  it("x deletes forward, 3x deletes three", () => {
    expect(createEditor(["abcdef"]).at(0).type("x").text()).toBe("bcdef");
    expect(createEditor(["abcdef"]).at(0).type("3x").text()).toBe("def");
  });

  it("x never crosses the line break", () => {
    const editor = createEditor(["ab", "cd"]).at(0, 1).type("3x");
    expect(editor.text()).toBe("a\ncd");
  });

  it("X deletes backwards", () => {
    const editor = createEditor(["abcdef"]).at(0, 3).type("X");
    expect(editor.text()).toBe("abdef");
  });

  it("D and C cut to the end of the line", () => {
    expect(createEditor(["hello world"]).at(0, 5).type("D").text()).toBe("hello");
    const changed = createEditor(["hello world"]).at(0, 5).type("C");
    expect(changed.text()).toBe("hello");
    expect(changed.mode).toBe("insert");
  });

  it("r replaces characters in place", () => {
    expect(createEditor(["abc"]).at(0).type("rz").text()).toBe("zbc");
    expect(createEditor(["abc"]).at(0).type("2rz").text()).toBe("zzc");
  });

  it("r does not run past the end of the line", () => {
    expect(createEditor(["ab", "cd"]).at(0, 1).type("5rz").text()).toBe("az\ncd");
  });

  it("J joins the next line with a space", () => {
    const editor = createEditor(["one", "two", "three"]).at(0).type("J");
    expect(editor.text()).toBe("one two\nthree");
  });

  it("3J joins three lines", () => {
    const editor = createEditor(["one", "two", "three"]).at(0).type("3J");
    expect(editor.text()).toBe("one two three");
  });

  it("~ toggles case and moves on", () => {
    const editor = createEditor(["abc"]).at(0).type("~~");
    expect(editor.text()).toBe("ABc");
  });
});

describe("case operators", () => {
  it("guu lowercases the line, gUU uppercases it", () => {
    expect(createEditor(["MiXeD"]).at(0).type("guu").text()).toBe("mixed");
    expect(createEditor(["MiXeD"]).at(0).type("gUU").text()).toBe("MIXED");
  });

  it("gUiw uppercases a word", () => {
    const editor = createEditor(["one two"]).at(0, 4).type("gUiw");
    expect(editor.text()).toBe("one TWO");
  });

  it("preserves marks while rewriting text", () => {
    const bold = schema.marks.bold.create();
    const editor = createEditor([""]);
    editor.host.view.dispatch(
      editor.host.view.state.tr.replaceWith(
        0,
        editor.host.view.state.doc.content.size,
        schema.nodes.paragraph.create(null, schema.text("word", [bold]))
      )
    );
    editor.at(0).type("gUU");
    expect(editor.text()).toBe("WORD");
    expect(editor.host.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(1);
  });
});

describe("open line", () => {
  it("o opens below and enters Insert", () => {
    const editor = createEditor(["one", "two"]).at(0).type("o");
    expect(editor.mode).toBe("insert");
    editor.insert("new");
    expect(editor.text()).toBe("one\nnew\ntwo");
  });

  it("O opens above", () => {
    const editor = createEditor(["one", "two"]).at(1).type("O");
    editor.insert("new");
    expect(editor.text()).toBe("one\nnew\ntwo");
  });
});

describe("visual mode", () => {
  it("vd deletes the character under the cursor", () => {
    const editor = createEditor(["abc"]).at(0).type("vd");
    expect(editor.text()).toBe("bc");
    expect(editor.mode).toBe("normal");
  });

  it("vlld deletes three characters", () => {
    const editor = createEditor(["abcdef"]).at(0).type("vlld");
    expect(editor.text()).toBe("def");
  });

  it("ve selects to the end of the word", () => {
    const editor = createEditor(["foo bar"]).at(0).type("ved");
    expect(editor.text()).toBe(" bar");
  });

  it("V selects the whole line", () => {
    const editor = createEditor(["one", "two", "three"]).at(1).type("Vd");
    expect(editor.text()).toBe("one\nthree");
  });

  it("Vj selects two lines", () => {
    const editor = createEditor(["one", "two", "three"]).at(0).type("Vjd");
    expect(editor.text()).toBe("three");
  });

  it("viw selects the word under the cursor", () => {
    const editor = createEditor(["the quick brown"]).at(0, 5).type("viwd");
    expect(editor.text()).toBe("the  brown");
  });

  it("vy leaves Visual mode with the text yanked", () => {
    const editor = createEditor(["ab"]).at(0).type("vly");
    expect(editor.mode).toBe("normal");
    editor.type("p");
    expect(editor.text()).toBe("aabb");
  });

  it("Vp replaces the selected line", () => {
    const editor = createEditor(["one", "two"]).at(0).type("yy").at(1).type("Vp");
    expect(editor.text()).toBe("one\none");
  });

  it("vU uppercases the selection", () => {
    const editor = createEditor(["abcd"]).at(0).type("vlU");
    expect(editor.text()).toBe("ABcd");
  });

  it("o swaps the ends so the selection can grow backwards", () => {
    const editor = createEditor(["abcdef"]).at(0, 3).type("vohhd");
    expect(editor.text()).toBe("aef");
  });

  it("v twice returns to Normal mode", () => {
    const editor = createEditor(["abc"]).at(0).type("vv");
    expect(editor.mode).toBe("normal");
  });
});

describe("motions", () => {
  it("w, b and e move by word", () => {
    const editor = createEditor(["foo bar baz"]).at(0);
    expect(editor.type("w").cursor()).toBe(4);
    expect(editor.type("e").cursor()).toBe(6);
    expect(editor.type("b").cursor()).toBe(4);
  });

  it("0, ^ and $ move within the line", () => {
    const editor = createEditor(["  hi there"]).at(0, 5);
    expect(editor.type("0").cursor()).toBe(0);
    expect(editor.type("^").cursor()).toBe(2);
    expect(editor.type("$").cursor()).toBe(9);
  });

  it("gg and G jump to the first and last line", () => {
    const editor = createEditor(["one", "two", "three"]).at(1);
    expect(editor.type("gg").cursor()).toBe(0);
    expect(editor.type("G").cursor()).toBe(8);
    expect(editor.type("2gg").cursor()).toBe(4);
  });

  it("the cursor never rests past the last character", () => {
    const editor = createEditor(["ab"]).at(0);
    expect(editor.type("lll").cursor()).toBe(1);
  });

  it("; repeats the last f", () => {
    const editor = createEditor(["a,b,c"]).at(0);
    expect(editor.type("f,").cursor()).toBe(1);
    expect(editor.type(";").cursor()).toBe(3);
    expect(editor.type(",").cursor()).toBe(1);
  });

  it("% jumps between matching brackets", () => {
    const editor = createEditor(["f(a, b)"]).at(0, 1);
    expect(editor.type("%").cursor()).toBe(6);
    expect(editor.type("%").cursor()).toBe(1);
  });
});

describe("repeat", () => {
  it(". repeats the last change", () => {
    const editor = createEditor(["one", "two", "three"]).at(0).type("dd");
    editor.type(".");
    expect(editor.text()).toBe("three");
  });

  it(". replays the text typed during a change", () => {
    const editor = createEditor(["alpha beta", "alpha gamma"]).at(0).type("cw");
    editor.insert("X");
    // Leaving Insert mode is the hook's job; record the typing the way it does.
    editor.host.lastChange!.insertedText = "X";
    editor.host.setMode("normal");
    editor.at(1).type(".");
    expect(editor.text()).toBe("X beta\nX gamma");
  });

  it("does not repeat a pure motion", () => {
    const editor = createEditor(["one", "two"]).at(0).type("dd");
    editor.type("w");
    editor.type(".");
    expect(editor.text()).toBe("");
  });
});
