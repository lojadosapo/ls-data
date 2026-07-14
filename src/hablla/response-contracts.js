function validateItems(items, dataset) {
  const invalidIndex = items.findIndex(
    (item) => !item || typeof item !== "object" || Array.isArray(item),
  );
  if (invalidIndex !== -1) {
    throw new Error(
      `Hablla retornou item invalido em ${dataset} no indice ${invalidIndex}`,
    );
  }
  return items;
}

function extractList(payload, { dataset, keys }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Hablla retornou ${dataset} em formato inesperado`);
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    if (!Array.isArray(payload[key])) {
      throw new Error(
        `Hablla retornou ${dataset}.${key} em formato inesperado`,
      );
    }
    return validateItems(payload[key], dataset);
  }

  throw new Error(
    `Hablla retornou ${dataset} sem uma lista ${keys.join("/")}`,
  );
}

function extractCards(payload) {
  return extractList(payload, { dataset: "cards", keys: ["results"] });
}

function extractAttendants(payload) {
  return extractList(payload, {
    dataset: "attendants",
    keys: ["results"],
  });
}

module.exports = { extractAttendants, extractCards };
