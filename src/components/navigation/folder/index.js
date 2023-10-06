// const FolderItem = ({ folder, onSelectFolder }) => {
//   const [isExpanded, setIsExpanded] = useState(false);

//   const handleFolderClick = () => {
//     setIsExpanded(!isExpanded);
//   };

//   return (
//     <>
//       <div
//         onClick={handleFolderClick}
//         className="flex items-center p-2 cursor-pointer hover:bg-gray-200"
//       >
//         {folder.subfolders.length > 0 && (
//           <span className={`mr-1 text-xs ${isExpanded ? "font-bold" : ""}`}>
//             {isExpanded ? "▾" : "▸"}
//           </span>
//         )}
//         <span onClick={() => onSelectFolder(folder)}>{folder.name}</span>
//       </div>
//       {isExpanded && (
//         <div className="pl-4">
//           <FolderList
//             folders={folder.subfolders}
//             onSelectFolder={onSelectFolder}
//           />
//         </div>
//       )}
//     </>
//   );
// };

// export default FolderItem;
