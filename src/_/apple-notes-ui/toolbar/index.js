import React from 'react'

const SearchBar = ({ onSearch }) => {
  return (
    <div
      className="p-2 py-1.5 flex justify-between items-center w-full"
      style={{
        backgroundImage: 'linear-gradient(to bottom, #E7E7E7 0%, #CDCDCD 100%)',
      }}
    >
      <input
        type="text"
        placeholder="Search..."
        onChange={(e) => onSearch(e.target.value)}
        className="h-6 p-2 border border-gray-300 rounded text-sm"
        style={{ background: '#F6F6F6', borderColor: '#D5D4D5' }}
      />
    </div>
  )
}

export default SearchBar
