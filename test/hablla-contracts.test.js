const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractAttendants,
  extractCards,
} = require("../src/hablla/response-contracts");

test("contratos Hablla aceitam somente listas explicitas observadas", () => {
  const cards = [{ id: "card-1" }];
  const attendants = [{ id: "attendant-1" }];

  assert.equal(extractCards({ results: cards }), cards);
  assert.equal(extractAttendants({ results: attendants }), attendants);
  assert.deepEqual(extractCards({ results: [] }), []);
});

test("resposta Hablla 200 malformada nunca vira lista vazia", () => {
  for (const payload of [undefined, null, {}, { results: null }, { results: {} }]) {
    assert.throws(() => extractCards(payload), /Hablla retornou/);
    assert.throws(() => extractAttendants(payload), /Hablla retornou/);
  }

  assert.throws(
    () => extractCards({ results: [null] }),
    /item invalido/,
  );
});

test("contrato malformado interrompe o fluxo antes de qualquer escrita", async () => {
  let replaces = 0;
  let upserts = 0;
  const processResponse = async (payload) => {
    const rows = extractCards(payload);
    replaces++;
    upserts += rows.length;
  };

  await assert.rejects(processResponse({ meta: { status: 200 } }));
  assert.equal(replaces, 0);
  assert.equal(upserts, 0);
});
