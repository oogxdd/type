import { Extension, InputRule } from "@tiptap/core";
// import { InputRule } from "prosemirror-inputrules";
import { inputRules, findReplace } from "prosemirror-inputrules";

// import { Plugin, PluginKey } from '@tiptap/pm/state'
// import { InputRule } from "@tiptap/pm/inputrules";
window.InputRule = InputRule;
console.log(InputRule);
// @tiptap/pm/inputrules

const inputRegex = /(?:^|\s)((?:\/new))$/;

const CustomExtension = Extension.create({
  name: "new-note-input-rule",

  get plugins() {
    return [
      new InputRule({
        regexp: inputRegex,
        find: inputRegex,
        // type: this.type,
        handler: () => {
          console.log("yyoyo");
          alert("yo");
        },
      }),

      new InputRule(
        // (a) => null,
        new RegExp(`/pub`),
        (state, match, start, end) => {
          console.log(99);
          alert(99);
          return state.tr.insertText("", end - 4, end).setMeta("publish", true);
        }
      ),
      // inputRules({
      //   find: this.options.find,
      //   handler: (state, match, start, end) => {
      //     return state.tr
      //       .insertText("", end - this.options.find.length, end)
      //       .setMeta("home", true);
      //   },
      // }),
    ];
  },

  addInputRules() {
    // console.log("hey");
    // console.log(InputRule);
    return [
      new InputRule({
        find: new RegExp(`/new`),
        type: this.type,
        handler: ({ state, range, match }) => {
          console.log(99);
          alert(99);
          const { tr } = state;
          const start = range.from;
          let end = range.to;

          // Insert final character of the trigger
          tr.insertText(" ", end);

          tr.replaceWith(
            start + 1,
            end,
            // Make my custom "foo" node (I don't know if there's
            // a better way to make a custom node).
            state.schema.node(
              "foo",
              {}, // attributes go here
              // Content: [ text node ]
              [state.schema.text(match[1])]
            )
          );
        },
      }),
      // new InputRule(
      //   // (a) => null,
      //   // new RegExp(`/pub`),
      //   (state, match, start, end) => {
      //     alert(99);
      //     console.log(99);
      //     return state.tr.insertText("", end - 4, end).setMeta("publish", true);
      //   }
      // ),
      // new InputRule({
      //   regexp: inputRegex,
      //   // find: inputRegex,
      //   // type: this.type,
      //   handler: () => {
      //     console.log("yyoyo");
      //     alert("yo");
      //   },
      // }),
    ];
  },
  // inputRules({ type }) {
  //   return [
  //     new InputRule(new RegExp(`/pub`), (state, match, start, end) => {
  //       alert(99);
  //       console.log(99);
  //       return state.tr.insertText("", end - 4, end).setMeta("publish", true);
  //     }),
  //   ];
  // }
});

export default CustomExtension;

// export default class Publish extends Extension {
