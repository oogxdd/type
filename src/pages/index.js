import dynamic from "next/dynamic";

const TextEditor = dynamic(() => import("@/components/editor/index.js"), {
  ssr: false,
});

const TextEditorPage = () => {
  return (
    <div>
      <TextEditor />
    </div>
  );
};

export default TextEditorPage;
