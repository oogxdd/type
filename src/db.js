// import low from "lowdb";
// import { LocalStorage } from "lowdb/browser";
// import id from "lodash-id";

// const adapter = new LocalStorage("db");
// const db = low(adapter);

// db.defaults({ folders: [], notes: [] }).write();

import low from "lowdb";
import LocalStorage from "lowdb/adapters/LocalStorage";
import id from "lodash-id";

const adapter = new LocalStorage("db");
const db = low(adapter);

db.defaults({
  folders: [
    {
      id: 1,
      name: "Folder 1",
      subfolders: [
        { id: 11, name: "Subfolder 1.1", subfolders: [] },
        { id: 12, name: "Subfolder 1.2", subfolders: [] },
      ],
    },
    {
      id: 2,
      name: "Folder 2",
      subfolders: [
        {
          id: 21,
          name: "Subfolder 2.1",
          subfolders: [{ id: 211, name: "Subfolder 2.1.1", subfolders: [] }],
        },
      ],
    },
  ],
  notes: [
    {
      id: 1,
      title: "Note 1",
      body: "This is note 1 content.",
      modifiedDate: "2023-04-25",
    },
    {
      id: 2,
      title: "Note 2",
      body: "This is note 2 content.",
      modifiedDate: "2023-04-24",
    },
  ],
}).write();
db._.mixin(id);

export default db;
