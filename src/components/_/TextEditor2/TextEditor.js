// import React, { useState, useEffect, useRef } from 'react';
// import { Editor } from '@tiptap/react';
// import { useEditor, EditorContent } from '@tiptap/react'
// import StarterKit from '@tiptap/starter-kit';
// import axios from 'axios';
// import SuggestionPopup from './SuggestionPopup';

// const TextEditor = () => {
//   // const [editor, setEditor] = useState(null);
//   const [suggestion, setSuggestion] = useState(null);
//   const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
//   const editorRef = useRef();

//     const editor = useEditor({
//       extensions: [StarterKit],
//       content: '',
//       onUpdate: ({ editor }) => {
//         console.log(editor.getHTML());
//       },
//     });

//   useEffect(() => {

//     document.addEventListener('keydown', handleKeyDown);
//     return () => {
//       document.removeEventListener('keydown', handleKeyDown);
//       // newEditor.destroy();
//     };
//   }, []);

//   const handleKeyDown = (e) => {
//     if (e.key === 'Tab') {
//       e.preventDefault();
//       handleTabPress();
//     } else if (e.key === 'Enter' && e.shiftKey) {
//       e.preventDefault();
//       handleShiftEnter();
//     }
//   };

//   const handleTabPress = async () => {
//     if (!editor) return;
//     const prompt = editor.getHTML();
//     const generatedText = await callTextGenerationAPI(prompt);

//     const { top, left } = getCursorPosition();
//     setPopupPosition({ top, left });
//     setSuggestion(generatedText);
//   };

//   const handleShiftEnter = async () => {
//     console.log(editor)
//     if (!editor) return;
//     const prompt = editor.getHTML();
//     const chatGptResponse = await callChatGPTAPI(prompt);
//     editor.chain().focus().insertContent(`<p>============<br>[ChatGPT]: ${chatGptResponse}<br>============</p>`).run();
//   };

//   const callTextGenerationAPI = async (prompt) => {
//     // Call your text generation model API here
//     // Replace the URL and parameters based on the API you're using
//     const response = await axios.post(
//       'https://api.example.com/text-generation',
//       { prompt },
//       { headers: { 'Authorization': `Bearer ${process.env.REACT_APP_API_KEY}` } }
//     );
//     return response.data.generated_text;
//   };

//   const callChatGPTAPI = async (prompt) => {
//     // Call the Chat GPT API here
//     // Replace the URL and parameters based on the API you're using
//     const response = await axios.post(
//       'https://api.example.com/chat-gpt',
//       { prompt },
//       { headers: { 'Authorization': `Bearer ${process.env.REACT_APP_API_KEY}` } }
//     );
//     return response.data.chat_gpt_response;
//   };

//   const getCursorPosition = () => {
//     const selection = window.getSelection();
//     const range = selection.getRangeAt(0);
//     const rect = range.getBoundingClientRect();
//     return {
//       top: rect.top + window.scrollY + rect.height,
//       left: rect.left + window.scrollX,
//     };
//   };

//   const handleSuggestionClick = () => {
//     editor.chain().focus().insertContent(suggestion).run();
//     setSuggestion(null);
//   };

//   return (
//     <div ref={editorRef}>
//     <EditorContent editor={editor} />
//       <SuggestionPopup
//         top={popupPosition.top}
//         left={popupPosition.left}
//         content={suggestion}
//         onClick={handleSuggestionClick}
//       />
//     </div>
//   );
// };

// export default TextEditor;
