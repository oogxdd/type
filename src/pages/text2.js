import dynamic from "next/dynamic";

const TextEditor = dynamic(() => import("@/components/TextEditor/index.js"), {
  ssr: false,
});

const TextEditorPage = () => {
  return (
    <div>
      yo
      <TextEditor />
    </div>
  );
};

export default TextEditorPage;
