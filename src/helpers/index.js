export function bumpLevel(id, index = "0") {
  // transform id to array of indexes
  let idArray = id.split(",");

  // push index.
  // if there is no existing tree: push 0, otherwise: last saved index
  idArray.push(index);

  // transform to string again
  const newId = idArray.join();

  return newId;
}

export function decreaseLevel(id) {
  // transform id to array of indexes
  let idArray = id.split(",");

  // remove the last index
  idArray.splice(-1);

  // transform to string again
  const newId = idArray.join();

  return newId;
}

export function incrementId(id) {
  const ids = id.split(",");
  const last = parseInt(ids[ids.length - 1]) + 1;
  ids[ids.length - 1] = last;
  return ids.join(",");
}

export function decrementId(id) {
  const ids = id.split(",");
  const last = parseInt(ids[ids.length - 1]) - 1;
  ids[ids.length - 1] = last;
  return ids.join(",");
}
