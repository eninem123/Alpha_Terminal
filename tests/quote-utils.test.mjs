import test from "node:test";
import assert from "node:assert/strict";
import {
  codeToSymbol,
  codeToEastmoneySecid,
  parseTencentQuoteText,
  parseSinaHqText,
  parseEastmoneyStockGetJson
} from "../quote-utils.mjs";

test("codeToSymbol maps A-share codes", () => {
  assert.equal(codeToSymbol("600000"), "sh600000");
  assert.equal(codeToSymbol("000001"), "sz000001");
  assert.equal(codeToSymbol("920001"), "bj920001");
  assert.equal(codeToSymbol("123456"), "");
});

test("codeToEastmoneySecid maps A-share codes", () => {
  assert.equal(codeToEastmoneySecid("600000"), "1.600000");
  assert.equal(codeToEastmoneySecid("000001"), "0.000001");
  assert.equal(codeToEastmoneySecid("920001"), "0.920001");
  assert.equal(codeToEastmoneySecid("123456"), "");
});

test("parseTencentQuoteText parses qt quote payload", () => {
  const body = 'v_sz000001="51~平安银行~000001~10.23~10.10~10.25~10.30~10.00~123~456~0~0~0~0~0~0~0~0~0~2026-04-09 15:00:00~0";';
  const parsed = parseTencentQuoteText(body);
  assert.ok(parsed);
  assert.equal(parsed.name, "平安银行");
  assert.equal(parsed.currentPrice, 10.23);
  assert.equal(parsed.basePrice, 10.1);
});

test("parseTencentQuoteText returns null on none match", () => {
  assert.equal(parseTencentQuoteText('v_pv_none_match="1";'), null);
  assert.equal(parseTencentQuoteText("illegal"), null);
});

test("parseSinaHqText parses hq.sinajs response", () => {
  const body =
    'var hq_str_sh600000="浦发银行,10.00,9.90,10.10,10.20,9.80,10.10,10.11,12345,67890,0,0,0,0,0,0,0,0,0,0,2026-04-09,15:00:00,00";';
  const parsed = parseSinaHqText(body);
  assert.ok(parsed);
  assert.equal(parsed.name, "浦发银行");
  assert.equal(parsed.currentPrice, 10.1);
  assert.equal(parsed.basePrice, 9.9);
});

test("parseEastmoneyStockGetJson parses push2 stock/get", () => {
  const j = { rc: 0, data: { f58: "平安银行", f43: 10.23, f60: 10.1 } };
  const parsed = parseEastmoneyStockGetJson(j);
  assert.ok(parsed);
  assert.equal(parsed.name, "平安银行");
  assert.equal(parsed.currentPrice, 10.23);
  assert.equal(parsed.basePrice, 10.1);
});
