import { useState, useEffect, useCallback } from "react";
import { bumpLevel, decreaseLevel, incrementId, decrementId } from "@/helpers";

const levels = [
  { level: 0, type: "word", tokens: 2 },
  { level: 1, type: "phrase", tokens: 12 },
  { level: 2, type: "sentence", tokens: 32 },
  { level: 3, type: "paragraph", tokens: 128 },
  { level: 4, type: "semi-article", tokens: 512 },
  { level: 5, type: "article", tokens: 1028 },
];

function AutocompleteSuggestions({ prompt: propPrompt, insertSuggestion }) {
  const [suggestions, setSuggestions] = useState({});
  // const [suggestions, setSuggestions] = useState({
  //   0: "0",
  //   "0,0": "0,0",
  //   "0,0,1": "0,0,1",
  //   "0,0,2": "0,0,2",
  //   "0,0,3": "0,0,3",
  //   "0,1": "0,1",
  //   "0,1,0": "0,1,0",
  //   "0,1,0": "0,1,0",
  //   "0,1,1": "0,1,1",
  //   1: "1",
  //   "1,0": "1,0",
  //   "1,0,0": "1,0,0",
  //   "1,0,1": "1,0,1",
  //   "1,0,2": "1,0,2",
  //   "1,1": "1,1",
  //   "1,1,0": "1,1,0",
  //   "1,1,1": "1,1,1",
  //   2: "2",
  //   3: "3",
  // });
  const [selectedId, setSelectedId] = useState("0");
  const [level, setLevel] = useState(0);

  // const [loading, setLoading] = useState(false);
  // const [suggestion, setSuggestion] = useState(undefined);

  // useEffect(() => {
  //   // Initial fetch
  //   printOrFetch("0");
  // }, []);

  const fetchSuggestion = (id, maxTokens) => {
    let idArray = id.split(",");
    idArray.splice(-1);
    let prevId = idArray.join();

    let gapText = "";
    let prompt = propPrompt;
    console.log("------");
    console.log(idArray);
    console.log(prevId);
    console.log(selectedId);
    console.log(prevId);
    console.log(suggestions[prevId]);

    if (suggestions[prevId]) {
      gapText = suggestions[prevId].replace("&nbsp;", " ");
      prompt += gapText;
    }
    console.log("gap text");

    // Fetch suggestion from API
    fetch(`/api/generate?prompt=${prompt}&max_tokens=${maxTokens}`, {
      method: "GET",
    })
      .then((res) => res.json())
      .then((json) => {
        console.log("json");
        console.log(json);
        console.log(id);

        // Save suggestions by id
        const newSuggestions = { ...suggestions };
        newSuggestions[id] = gapText + " " + json.res[0];
        setSuggestions(newSuggestions);
      });
  };

  const printOrFetch = (id) => {
    if (suggestions[id]) {
      // print
      // setSuggestion(suggestions[id]);
    } else {
      const maxTokens = levels.find((s) => s.level === level).tokens;
      fetchSuggestion(id, maxTokens);
    }
  };

  useEffect(() => {
    console.log("trigger effect");
    console.log(selectedId);
    printOrFetch(selectedId);
  }, [selectedId]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "ArrowDown") {
        // Select next suggestion
        const newId = incrementId(selectedId);
        setSelectedId(newId);
      } else if (e.key === "ArrowUp" && selectedId !== "0") {
        // Select previous suggestion
        const newId = decrementId(selectedId);
        setSelectedId(newId);
      } else if (e.key === "ArrowRight" && level < levels.length - 1) {
        // Increase suggestion length

        const newId = bumpLevel(selectedId);

        setLevel(level + 1);
        setSelectedId(newId);
      } else if (e.key === "ArrowLeft" && level > 0) {
        // Decrease suggestion length

        const newId = decreaseLevel(selectedId);

        setLevel(level - 1);
        setSelectedId(newId);
      } else if (e.key === "Enter") {
        // Use selected suggestion
        insertSuggestion(suggestions[selectedId]);
      }
    },
    [
      level,
      setLevel,
      selectedId,
      setSelectedId,
      insertSuggestion,
      // suggestions
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div className="suggestions" tabIndex={0}>
      {suggestions[selectedId] || "loading..."}
    </div>
  );
}

function TextareaWithSuggestions() {
  const [prompt, setPrompt] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);

  function handleChange(e) {
    setPrompt(e.target.value);
  }

  function handleSelect(suggestion) {
    setPopupOpen(false);
    setPrompt((prompt) => `${prompt} ${suggestion}`);
  }

  function handleKeyDown(e) {
    if (popupOpen) {
      e.preventDefault();
    }
    if (e.key === "Tab") {
      setPopupOpen(true);
      e.preventDefault();
    }

    if (e.key === "Escape") {
      setPopupOpen(false);
    }
  }

  return (
    <>
      <textarea
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        value={prompt}
        width="600px"
        height="600px"
        rows={24}
        style={{
          width: 1000,
          heigth: 600,
        }}
      />
      {popupOpen && (
        <AutocompleteSuggestions
          prompt={prompt}
          insertSuggestion={handleSelect}
        />
      )}
    </>
  );
}

export default TextareaWithSuggestions;
