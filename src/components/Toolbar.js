import React from 'react';

const SearchBar = ({ onSearch }) => {
  return (
    <div className="p-2">
      <input
        type="text"
        placeholder="Search..."
        onChange={(e) => onSearch(e.target.value)}
        className="w-full p-2 border border-gray-300 rounded-md"
      />
    </div>
  );
};

export default SearchBar;
