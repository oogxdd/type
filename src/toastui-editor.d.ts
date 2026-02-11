declare module "@toast-ui/editor" {
  type EditorEvents = {
    change?: () => void;
  };

  type EditorOptions = {
    el: HTMLElement;
    initialEditType?: "markdown" | "wysiwyg";
    hideModeSwitch?: boolean;
    usageStatistics?: boolean;
    initialValue?: string;
    height?: string;
    events?: EditorEvents;
  };

  export default class ToastEditor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    destroy(): void;
  }
}
