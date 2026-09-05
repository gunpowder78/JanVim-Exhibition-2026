local runtime_root = assert(vim.env.JANVIM_EXHIBITION_NVIM_ROOT, "test runtime root is required")
vim.opt.runtimepath:prepend(runtime_root)
vim.opt.runtimepath:prepend(vim.fn.fnamemodify(runtime_root, ":h") .. "/runtime/janvim/runtime")

local actions = require("janvim_exhibition.actions")

local TOKEN = "fixture-token-2026-lua"
local POEM = "白日依山尽\n黄河入海流"
local POEM_HASH = vim.fn.sha256(POEM)
local failures = 0

local function expect(condition, message)
  if not condition then
    error(message, 2)
  end
end

local function equal(actual, expected, message)
  if not vim.deep_equal(actual, expected) then
    error((message or "values differ") .. "\nactual: " .. vim.inspect(actual) .. "\nexpected: " .. vim.inspect(expected), 2)
  end
end

local function run(name, test)
  local ok, err = xpcall(test, debug.traceback)
  if ok then
    print("PASS agent: " .. name)
  else
    failures = failures + 1
    print("FAIL agent: " .. name .. "\n" .. tostring(err))
  end
end

local function command(cue_id, action, loop_id)
  return {
    schema = 1,
    token = TOKEN,
    loopId = loop_id or "loop-agent",
    cueId = cue_id,
    action = action,
  }
end

local function new_agent(extra)
  extra = extra or {}
  extra.token = TOKEN
  extra.ranges = {
    opening = {
      start_row = 0,
      start_col = 0,
      end_row = 0,
      end_col = #"白日依山尽",
    },
  }
  return actions.new(extra)
end

local function dispatch(agent, value)
  local acknowledgement
  agent:dispatch(value, function(result)
    acknowledgement = result
  end)
  expect(vim.wait(2000, function()
    return acknowledgement ~= nil
  end, 2), "agent did not ACK within two seconds")
  return acknowledgement
end

local function prepare(agent, cue_id)
  return dispatch(agent, command(cue_id or "cue-prepare", {
    type = "prepare",
    poem = POEM,
    expectedSha256 = POEM_HASH,
  }))
end

local function buffer_text(buffer_number)
  return table.concat(vim.api.nvim_buf_get_lines(buffer_number, 0, -1, true), "\n")
end

-- Only time is simulated: mutations, movement, buffer reads and viewport APIs stay real.
local function fake_clock()
  local clock = { ms = 0, events = {} }
  function clock.now()
    return clock.ms
  end
  function clock.defer(callback, delay_ms)
    local event = { callback = callback, at = clock.ms + delay_ms, cancelled = false }
    local handle = { closed = false }
    function handle:stop() event.cancelled = true end
    function handle:is_closing() return self.closed end
    function handle:close() self.closed = true end
    table.insert(clock.events, event)
    return handle
  end
  function clock:drain()
    local count = 0
    while #self.events > 0 do
      count = count + 1
      expect(count <= 1024, "fake scheduler exceeded its finite bound")
      local event = table.remove(self.events, 1)
      self.ms = math.max(self.ms, event.at)
      if not event.cancelled then event.callback() end
    end
  end
  function clock:dispatch(agent, value)
    local ack
    agent:dispatch(value, function(result) ack = result end)
    self:drain()
    return assert(ack, "action did not ACK")
  end
  return clock
end

run("cursor observer reports actual Chinese display cells during move and slow insertion", function()
  local clock = fake_clock()
  local samples = {}
  local agent = new_agent({ now = clock.now, defer = clock.defer,
    on_cursor = function(event) table.insert(samples, event) end })
  prepare(agent)
  equal(#samples, 0)
  local move_ack = clock:dispatch(agent, command("move-cells", { type = "move", keys = "l", ["repeat"] = 1 }))
  equal(move_ack.outcome, "applied")
  equal(move_ack.cursor, { row = 0, col = 3 }) -- ACK still uses byte columns.
  equal(#samples, 1, "real movement did not emit a cursor observation")
  equal(samples[1], { schema = 1, type = "cursor", loopId = "loop-agent", cueId = "move-cells",
    seq = 1, elapsedMs = 0, row = 0, cellCol = 2, viewRow = 0, viewCol = 2,
    rows = vim.api.nvim_win_get_height(0),
    cols = vim.api.nvim_win_get_width(0) - vim.fn.getwininfo(vim.api.nvim_get_current_win())[1].textoff })
  clock.ms = 125
  local insert_ack = clock:dispatch(agent, command("insert-cells", {
    type = "insert", text = "文山水", charsPerSecond = 8 }))
  equal(insert_ack.outcome, "applied")
  equal(buffer_text(assert(agent:buffer_number())), "白文山水日依山尽\n黄河入海流")
  equal(#samples, 3)
  equal({ samples[2].cellCol, samples[2].elapsedMs, samples[2].seq }, { 4, 125, 2 })
  equal({ samples[3].cellCol, samples[3].elapsedMs, samples[3].seq }, { 6, 250, 3 })
  equal(samples[3].cueId, "insert-cells")
  agent:dispose()
end)

run("cursor observer drops throttled movement without replay and rebases reset and stationary actions", function()
  local clock = fake_clock()
  local samples = {}
  local agent = new_agent({ now = clock.now, defer = clock.defer,
    on_cursor = function(event) table.insert(samples, event) end })
  prepare(agent)
  local function move(cue, key)
    return clock:dispatch(agent, command(cue, { type = "move", keys = key, ["repeat"] = 1 }))
  end
  move("stationary-first", "h")
  equal(#samples, 0)
  move("first-movement", "l")
  clock.ms = 124
  move("throttled", "l")
  equal(#samples, 1, "source must enforce 125ms spacing")
  equal(#clock.events, 0, "observation must not schedule replay")
  clock.ms = 125
  move("admitted", "l")
  equal(#samples, 2)
  equal(samples[2].cellCol, 6)
  clock:dispatch(agent, command("status-observation", { type = "status" }))
  local reset_ack = clock:dispatch(agent, command("reset-observation", { type = "reset" }))
  equal(reset_ack.bufferSha256, POEM_HASH)
  clock.ms = 250
  move("stationary-reset", "h")
  equal(#samples, 2)
  move("after-reset", "l")
  equal(#samples, 3)
  equal(samples[3].cellCol, 2)
  equal(samples[3].seq, 3)
  clock:dispatch(agent, command("prepare-observation", { type = "prepare", poem = POEM, expectedSha256 = POEM_HASH }))
  equal(#samples, 3)
  agent:dispose()
  clock:drain()
  equal(#samples, 3)
end)

run("cursor observer samples actual move chunks and selection endpoints", function()
  local clock = fake_clock()
  local samples = {}
  local agent = new_agent({ now = clock.now,
    defer = function(callback, delay_ms) return clock.defer(callback, math.max(delay_ms, 125)) end,
    on_cursor = function(event) table.insert(samples, event) end })
  local poem = string.rep("山", 60)
  clock:dispatch(agent, command("prepare-chunks", { type = "prepare", poem = poem, expectedSha256 = vim.fn.sha256(poem) }))
  local ack = clock:dispatch(agent, command("move-chunks", { type = "move", keys = "l", ["repeat"] = 33 }))
  equal(ack.outcome, "applied")
  equal(#samples, 3, "each admitted real chunk must be observable")
  equal({ samples[1].cellCol, samples[2].cellCol, samples[3].cellCol }, { 32, 64, 66 })
  local select_ack = clock:dispatch(agent, command("select-endpoints", { type = "select", rangeId = "opening" }))
  equal(select_ack.outcome, "applied")
  equal(#samples, 5)
  equal({ samples[4].cellCol, samples[5].cellCol }, { 0, 8 })
  equal(samples[5].elapsedMs, 125)
  agent:dispose()
end)

run("cursor observer uses the active logical viewport and never hashes or activates per sample", function()
  local clock = fake_clock()
  local samples = {}
  local agent = new_agent({ now = clock.now, defer = clock.defer,
    on_cursor = function(event) table.insert(samples, event) end })
  local poem = string.rep(string.rep("山", 120) .. "\n", 50) .. "末"
  clock:dispatch(agent, command("prepare-viewport", { type = "prepare", poem = poem, expectedSha256 = vim.fn.sha256(poem) }))
  local observer = assert(agent.cursor_observer, "optional observer is missing")
  local show_buffer = assert(agent:buffer_number())
  vim.api.nvim_win_set_cursor(0, { 11, 6 })
  observer:begin(command("viewport", { type = "move", keys = "l", ["repeat"] = 1 }), show_buffer)
  local original_wrap = vim.wo.wrap
  vim.wo.wrap = false
  vim.api.nvim_win_set_cursor(0, { 12, 9 })
  vim.fn.winrestview({ topline = 10, leftcol = 4 })
  local original_status = agent.show_buffer.status
  agent.show_buffer.status = function() error("sampling called status") end
  observer:sample(show_buffer)
  agent.show_buffer.status = original_status
  equal(#samples, 1)
  equal({ samples[1].row, samples[1].cellCol, samples[1].viewRow, samples[1].viewCol }, { 11, 6, 2, 2 })
  clock.ms = 125
  vim.api.nvim_win_set_cursor(0, { 50, 300 })
  vim.fn.winrestview({ topline = 1, leftcol = 0 })
  observer:sample(show_buffer)
  equal(#samples, 2)
  equal(samples[2].viewRow, samples[2].rows - 1)
  equal(samples[2].viewCol, samples[2].cols - 1)
  local foreign = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(foreign, 0, -1, true, { "FOREIGN-SENTINEL" })
  vim.api.nvim_set_current_buf(foreign)
  clock.ms = 250
  observer:sample(show_buffer)
  equal(vim.api.nvim_get_current_buf(), foreign)
  equal(buffer_text(foreign), "FOREIGN-SENTINEL")
  equal(#samples, 2)
  vim.wo.wrap = original_wrap
  agent:dispose()
  vim.api.nvim_buf_delete(foreign, { force = true })
end)

run("cursor callback failures preserve real writes ACKs reset hashes and timer cleanup", function()
  local clock = fake_clock()
  local calls = 0
  local agent = new_agent({ now = clock.now, defer = clock.defer, on_cursor = function()
    calls = calls + 1
    error("injected observer failure")
  end })
  prepare(agent)
  local ack = clock:dispatch(agent, command("throw-insert", { type = "insert", text = "文山水", charsPerSecond = 8 }))
  equal(ack.outcome, "applied")
  expect(calls > 0, "failure isolation was not exercised")
  equal(buffer_text(assert(agent:buffer_number())), "文山水白日依山尽\n黄河入海流")
  local reset_ack = clock:dispatch(agent, command("throw-reset", { type = "reset" }))
  equal(reset_ack.outcome, "applied")
  equal(reset_ack.bufferSha256, POEM_HASH)
  agent:dispatch(command("cancel-insert", { type = "insert", text = "文山", charsPerSecond = 8 }), function() end)
  local before_dispose = calls
  agent:dispose()
  clock:drain()
  equal(calls, before_dispose)
  equal(next(agent.timers), nil)
  equal(agent:buffer_number(), nil)
end)

run("disabled observation leaves movement and insertion available without an observer", function()
  local clock = fake_clock()
  local agent = new_agent({ now = clock.now, defer = clock.defer })
  prepare(agent)
  equal(agent.cursor_observer, nil)
  equal(clock:dispatch(agent, command("disabled-move", { type = "move", keys = "l", ["repeat"] = 1 })).outcome, "applied")
  equal(clock:dispatch(agent, command("disabled-insert", { type = "insert", text = "文", charsPerSecond = 8 })).outcome, "applied")
  agent:dispose()
end)

run("prepare creates a nameless nofile buffer and never touches a source poem", function()
  local source_path = vim.fn.tempname() .. "-source-poem.txt"
  local source = assert(io.open(source_path, "wb"))
  source:write("SOURCE-SENTINEL")
  source:close()

  local agent = new_agent()
  local ack = prepare(agent)
  local buffer_number = assert(agent:buffer_number())

  equal(ack.outcome, "applied")
  equal(vim.api.nvim_get_option_value("buftype", { buf = buffer_number }), "nofile")
  equal(vim.api.nvim_get_option_value("swapfile", { buf = buffer_number }), false)
  equal(vim.api.nvim_get_option_value("undofile", { buf = buffer_number }), false)
  equal(vim.api.nvim_get_option_value("filetype", { buf = buffer_number }), "markdown")
  equal(vim.api.nvim_get_option_value("syntax", { buf = buffer_number }), "markdown")
  equal(vim.api.nvim_buf_get_name(buffer_number), "")
  equal(buffer_text(buffer_number), POEM)

  local unchanged = assert(io.open(source_path, "rb"))
  equal(unchanged:read("*a"), "SOURCE-SENTINEL")
  unchanged:close()
  vim.fn.delete(source_path)
  agent:dispose()
end)

run("prepare and reset keep compact absolute column numbers", function()
  local window_number = vim.api.nvim_get_current_win()
  local original_number = vim.api.nvim_get_option_value("number", { win = window_number })
  local original_relativenumber = vim.api.nvim_get_option_value("relativenumber", { win = window_number })
  local original_numberwidth = vim.api.nvim_get_option_value("numberwidth", { win = window_number })
  local agent = new_agent()

  local function assert_column_numbers()
    equal(vim.api.nvim_get_option_value("number", { win = window_number }), true)
    equal(vim.api.nvim_get_option_value("relativenumber", { win = window_number }), false)
    equal(vim.api.nvim_get_option_value("numberwidth", { win = window_number }), 2)
  end

  local ok, error_message = xpcall(function()
    prepare(agent)
    assert_column_numbers()
    dispatch(agent, command("cue-column-number-reset", { type = "reset" }))
    assert_column_numbers()
  end, debug.traceback)

  agent:dispose()
  vim.api.nvim_set_option_value("number", original_number, { win = window_number })
  vim.api.nvim_set_option_value("relativenumber", original_relativenumber, { win = window_number })
  vim.api.nvim_set_option_value("numberwidth", original_numberwidth, { win = window_number })
  if not ok then
    error(error_message, 0)
  end
end)

run("vermilion English punctuation with a solid full stop is display-only and survives reset", function()
  local punctuation_text = "甲，乙。丙；丁：戊？己！庚、辛"
  local mappings = {
    { source = "，", replacement = ",", group = "JanVimCompactComma" },
    { source = "。", replacement = "•", group = "JanVimCompactFullStop" },
    { source = "；", replacement = ";", group = "JanVimCompactSemicolon" },
    { source = "：", replacement = ":", group = "JanVimCompactColon" },
    { source = "？", replacement = "?", group = "JanVimCompactQuestion" },
    { source = "！", replacement = "!", group = "JanVimCompactExclamation" },
    { source = "、", replacement = ",", group = "JanVimCompactEnumeration" },
  }
  local expected_buffer_text = punctuation_text .. "\n黄河入海流"
  local expected_buffer_hash = vim.fn.sha256(expected_buffer_text)
  local original_conceal = vim.api.nvim_get_hl(0, { name = "Conceal", link = true })
  vim.api.nvim_set_hl(0, "Conceal", { fg = "#112233" })
  local agent = new_agent()
  local window_number = vim.api.nvim_get_current_win()

  local function replace_and_assert(cue_id)
    local replace_ack = dispatch(agent, command(cue_id, {
      type = "replace",
      rangeId = "opening",
      text = punctuation_text,
    }))
    equal(replace_ack.outcome, "applied")
    equal(replace_ack.bufferSha256, expected_buffer_hash)

    local buffer_number = assert(agent:buffer_number())
    vim.api.nvim_set_current_buf(buffer_number)
    equal(buffer_text(buffer_number), expected_buffer_text)
    equal(vim.wo.conceallevel, 2)
    equal(vim.wo.concealcursor, "nvic")

    local line = vim.api.nvim_buf_get_lines(buffer_number, 0, 1, true)[1]
    for _, mapping in ipairs(mappings) do
      equal(vim.fn.strdisplaywidth(mapping.replacement), 1)
      local byte_column = assert(line:find(mapping.source, 1, true))
      local concealed = vim.fn.synconcealed(1, byte_column)
      equal(concealed[1], 1)
      equal(concealed[2], mapping.replacement)
      local syntax_id = vim.fn.synID(1, byte_column, 1)
      equal(vim.fn.synIDattr(syntax_id, "name"), mapping.group)
    end
    local global_conceal = vim.api.nvim_get_hl(0, { name = "Conceal", link = true })
    equal(global_conceal.fg, 0x112233)
    local highlight_namespace = vim.api.nvim_get_hl_ns({ winid = window_number })
    expect(highlight_namespace > 0, "punctuation highlight namespace is not window-scoped")
    local punctuation_highlight = vim.api.nvim_get_hl(
      highlight_namespace,
      { name = "Conceal", link = true }
    )
    equal(punctuation_highlight.fg, 0xB74133)
    equal(punctuation_highlight.link, nil)
    equal(punctuation_highlight.bg, nil)
    equal(punctuation_highlight.bold, nil)
    equal(punctuation_highlight.italic, nil)
  end

  local ok, error_message = xpcall(function()
    prepare(agent)
    replace_and_assert("cue-compact-before-reset")
    local reset_ack = dispatch(agent, command("cue-compact-reset", { type = "reset" }))
    equal(reset_ack.bufferSha256, POEM_HASH)
    replace_and_assert("cue-compact-after-reset")
    agent:dispose()
    equal(vim.api.nvim_get_hl_ns({ winid = window_number }), -1)
  end, debug.traceback)
  agent:dispose()
  vim.api.nvim_set_hl(0, "Conceal", original_conceal)
  if not ok then
    error(error_message, 0)
  end
end)

run("balanced semantic palette is display-only and survives reset", function()
  local semantic_text = "entropy 信息论 山 回写 42 OSC"
  local expectations = {
    { text = "entropy", syntax_group = "JanVimEnglishTech", highlight_group = "Function" },
    { text = "信息论", syntax_group = "JanVimChineseTech", highlight_group = "Type" },
    { text = "山", syntax_group = "JanVimLandscape", highlight_group = "String" },
    { text = "回写", syntax_group = "JanVimProcess", highlight_group = "Keyword" },
    { text = "42", syntax_group = "JanVimNumber", highlight_group = "Number" },
    { text = "OSC", syntax_group = "JanVimAcronym", highlight_group = "Constant" },
  }
  local expected_buffer_text = semantic_text .. "\n黄河入海流"
  local expected_buffer_hash = vim.fn.sha256(expected_buffer_text)
  local agent = new_agent()

  local function replace_and_assert(cue_id)
    local replace_ack = dispatch(agent, command(cue_id, {
      type = "replace",
      rangeId = "opening",
      text = semantic_text,
    }))
    equal(replace_ack.outcome, "applied")
    equal(replace_ack.bufferSha256, expected_buffer_hash)

    local buffer_number = assert(agent:buffer_number())
    vim.api.nvim_set_current_buf(buffer_number)
    equal(buffer_text(buffer_number), expected_buffer_text)

    local line = vim.api.nvim_buf_get_lines(buffer_number, 0, 1, true)[1]
    for _, expectation in ipairs(expectations) do
      local byte_column = assert(line:find(expectation.text, 1, true))
      local syntax_id = vim.fn.synID(1, byte_column, 1)
      equal(vim.fn.synIDattr(syntax_id, "name"), expectation.syntax_group)
      equal(
        vim.api.nvim_get_hl(0, { name = expectation.syntax_group, link = true }).link,
        expectation.highlight_group
      )
    end
  end

  prepare(agent)
  replace_and_assert("cue-balanced-palette-before-reset")
  local reset_ack = dispatch(agent, command("cue-balanced-palette-reset", { type = "reset" }))
  equal(reset_ack.bufferSha256, POEM_HASH)
  replace_and_assert("cue-balanced-palette-after-reset")
  agent:dispose()
end)

run("insert and replace mutate only the tracked exhibition buffer", function()
  local agent = new_agent()
  prepare(agent)
  local show_buffer = assert(agent:buffer_number())
  local foreign_buffer = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(foreign_buffer, 0, -1, true, { "FOREIGN-SENTINEL" })
  vim.api.nvim_set_current_buf(foreign_buffer)

  local insert_ack = dispatch(agent, command("cue-insert", {
    type = "insert",
    text = "文",
    charsPerSecond = 1000,
  }))
  equal(insert_ack.outcome, "applied")
  equal(buffer_text(foreign_buffer), "FOREIGN-SENTINEL")
  expect(buffer_text(show_buffer):find("文", 1, true) ~= nil, "insert did not reach show buffer")

  dispatch(agent, command("cue-reset-before-replace", { type = "reset" }))
  show_buffer = assert(agent:buffer_number())
  local replace_ack = dispatch(agent, command("cue-replace", {
    type = "replace",
    rangeId = "opening",
    text = "新句",
  }))
  equal(replace_ack.outcome, "applied")
  expect(buffer_text(show_buffer):match("^新句") ~= nil, "known range was not replaced")
  equal(buffer_text(foreign_buffer), "FOREIGN-SENTINEL")

  agent:dispose()
  if vim.api.nvim_buf_is_valid(foreign_buffer) then
    vim.api.nvim_buf_delete(foreign_buffer, { force = true })
  end
end)

run("insert pacing does not accumulate repeated timer lateness beyond the acceptance overhead", function()
  local now_ms = 0
  local scheduled = {}
  local function defer_with_six_ms_lateness(callback, delay_ms)
    local event = {
      callback = callback,
      cancelled = false,
      due_ms = now_ms + delay_ms + 6,
    }
    local handle = { closed = false }
    function handle:stop()
      event.cancelled = true
    end
    function handle:is_closing()
      return self.closed
    end
    function handle:close()
      self.closed = true
    end
    table.insert(scheduled, event)
    return handle
  end

  local agent = new_agent({
    defer = defer_with_six_ms_lateness,
    now = function()
      return now_ms
    end,
  })
  prepare(agent)

  local acknowledgement
  agent:dispatch(command("cue-paced-insert", {
    type = "insert",
    text = "若把诗句视为离散信源，层楼不是终点，而是观察窗口的扩展。",
    charsPerSecond = 24,
  }), function(result)
    acknowledgement = result
  end)

  while #scheduled > 0 do
    table.sort(scheduled, function(left, right)
      return left.due_ms < right.due_ms
    end)
    local event = table.remove(scheduled, 1)
    now_ms = event.due_ms
    if not event.cancelled then
      event.callback()
    end
  end

  equal(acknowledgement.outcome, "applied")
  expect(now_ms < 1248, "insert timer lateness exceeded the 100 ms acceptance overhead: " .. now_ms)
  agent:dispose()
end)

run("unknown and stale ranges plus unsafe actions are rejected", function()
  local agent = new_agent()
  prepare(agent)

  local unknown = dispatch(agent, command("cue-unknown-range", {
    type = "select",
    rangeId = "missing",
  }))
  equal(unknown.outcome, "rejected")
  equal(unknown.errorCode, "unknown-range")

  local replaced = dispatch(agent, command("cue-replace-once", {
    type = "replace",
    rangeId = "opening",
    text = "新句",
  }))
  equal(replaced.outcome, "applied")
  local stale = dispatch(agent, command("cue-replace-stale", {
    type = "replace",
    rangeId = "opening",
    text = "再次替换",
  }))
  equal(stale.outcome, "rejected")
  equal(stale.errorCode, "unknown-range")

  local repeat_ack = dispatch(agent, command("cue-repeat", { type = "move", keys = "j", ["repeat"] = 257 }))
  equal(repeat_ack.outcome, "rejected")
  local text_ack = dispatch(agent, command("cue-long", {
    type = "insert",
    text = string.rep("a", 513),
    charsPerSecond = 20,
  }))
  equal(text_ack.outcome, "rejected")
  local ex_ack = dispatch(agent, command("cue-ex", { type = "ex", command = ":write" }))
  equal(ex_ack.outcome, "rejected")

  agent:dispose()
end)

run("whitelisted movement and a prepared named range use visible editor state", function()
  local agent = new_agent()
  prepare(agent)

  local moved = dispatch(agent, command("cue-move-down", {
    type = "move",
    keys = "j",
    ["repeat"] = 1,
  }))
  equal(moved.outcome, "applied")
  equal(moved.cursor.row, 1)

  dispatch(agent, command("cue-reset-before-select", { type = "reset" }))
  local selected = dispatch(agent, command("cue-select-opening", {
    type = "select",
    rangeId = "opening",
  }))
  equal(selected.outcome, "applied")
  equal(selected.mode, "v")
  equal(selected.cursor.row, 0)
  equal(selected.cursor.col, 12)
  agent:dispose()
end)

run("reset deletes the old buffer and recreates the validated snapshot", function()
  local agent = new_agent()
  prepare(agent)
  local old_buffer = assert(agent:buffer_number())
  dispatch(agent, command("cue-reset-insert", {
    type = "insert",
    text = "临时",
    charsPerSecond = 1000,
  }))

  local reset_ack = dispatch(agent, command("cue-reset", { type = "reset" }))
  local new_buffer = assert(agent:buffer_number())
  expect(new_buffer ~= old_buffer, "reset reused the old buffer")
  expect(not vim.api.nvim_buf_is_valid(old_buffer), "reset left the old buffer alive")
  equal(buffer_text(new_buffer), POEM)
  equal(vim.api.nvim_get_option_value("filetype", { buf = new_buffer }), "markdown")
  equal(vim.api.nvim_get_option_value("syntax", { buf = new_buffer }), "markdown")
  equal(reset_ack.bufferSha256, POEM_HASH)
  agent:dispose()
end)

run("duplicate cues never insert twice and status reports mode cursor and hash", function()
  local agent = new_agent()
  prepare(agent)
  local insert = command("cue-idempotent", {
    type = "insert",
    text = "唯一",
    charsPerSecond = 1000,
  })
  local first = dispatch(agent, insert)
  local first_text = buffer_text(assert(agent:buffer_number()))
  local duplicate = dispatch(agent, insert)
  equal(first.outcome, "applied")
  equal(duplicate.outcome, "duplicate")
  equal(buffer_text(assert(agent:buffer_number())), first_text)

  local status = dispatch(agent, command("cue-status", { type = "status" }))
  expect(type(status.mode) == "string" and #status.mode > 0, "status mode is missing")
  expect(type(status.cursor.row) == "number" and status.cursor.row >= 0, "status row is invalid")
  expect(type(status.cursor.col) == "number" and status.cursor.col >= 0, "status col is invalid")
  equal(status.bufferSha256, vim.fn.sha256(first_text))
  agent:dispose()
end)

run("shutdown closes only the agent connection and accepts no user string", function()
  local close_count = 0
  local agent = new_agent({
    close_connection = function()
      close_count = close_count + 1
    end,
  })
  prepare(agent)

  local unsafe = dispatch(agent, command("cue-unsafe-shutdown", {
    type = "shutdown",
    command = ":qa!",
  }))
  equal(unsafe.outcome, "rejected")
  equal(close_count, 0)

  local safe = dispatch(agent, command("cue-shutdown", { type = "shutdown" }))
  equal(safe.outcome, "applied")
  equal(close_count, 1)
  expect(agent:buffer_number() ~= nil, "shutdown destroyed the show buffer")
  agent:dispose()
end)

local function new_connection_fixture(options)
  options = options or {}
  local exhibition = require("janvim_exhibition")
  local writes = {}
  local deferred = {}
  local fake_tcp = { closed = false, close_count = 0, reader = nil }

  function fake_tcp:connect(host, port, callback)
    equal(host, "127.0.0.1")
    equal(port, 32123)
    callback(nil)
  end

  function fake_tcp:write(payload, callback)
    if options.fail_cursor_write and vim.json.decode(payload).type == "cursor" then
      error("injected observational write failure")
    end
    table.insert(writes, { payload = payload, callback = callback })
    return true
  end

  function fake_tcp:get_write_queue_size()
    return self.queue_size or 0
  end

  function fake_tcp:read_start(callback)
    self.reader = callback
  end

  function fake_tcp:read_stop()
    self.reader = nil
  end

  function fake_tcp:is_closing()
    return self.closed
  end

  function fake_tcp:close()
    self.close_count = self.close_count + 1
    self.closed = true
  end

  local fake_timer = { closed = false, stopped = false }
  function fake_timer:start(timeout_ms, repeat_ms, callback)
    equal(timeout_ms, 1000)
    equal(repeat_ms, 0)
    self.callback = callback
  end
  function fake_timer:stop()
    self.stopped = true
  end
  function fake_timer:is_closing()
    return self.closed
  end
  function fake_timer:close()
    self.closed = true
  end

  local setup_options = {
    port = 32123,
    token = TOKEN,
    uv = {
      new_tcp = function()
        return fake_tcp
      end,
      new_timer = function()
        return fake_timer
      end,
      os_getppid = function()
        return options.parent_pid or 7628
      end,
      kill = options.kill or function(pid, signal)
        equal(pid, options.parent_pid or 7628)
        equal(signal, 0)
        return 0
      end,
    },
    agent = options.agent,
    cursor_observer = options.cursor_observer,
    now = options.now,
    schedule_wrap = options.schedule_wrap or function(callback)
      return callback
    end,
    schedule = options.schedule or function(callback)
      callback()
    end,
    defer = options.defer or function(callback, delay_ms)
      table.insert(deferred, { callback = callback, delay_ms = delay_ms })
    end,
    parent_pid = options.parent_pid or 7628,
    parent_alive = options.parent_alive,
  }
  if not options.use_default_exit_backend then
    setup_options.exit_backend = options.exit_backend or function() end
  end
  local connection = exhibition.setup(setup_options)

  return {
    connection = connection,
    fake_tcp = fake_tcp,
    fake_timer = fake_timer,
    writes = writes,
    deferred = deferred,
  }
end

run("init cursor opt-in requires exactly environment 1 or an explicit test option", function()
  local previous = vim.env.JANVIM_EXHIBITION_CURSOR_OBSERVER
  local ok, err = xpcall(function()
    for _, value in ipairs({ "", "0", "true", "1" }) do
      vim.env.JANVIM_EXHIBITION_CURSOR_OBSERVER = value
      local fixture = new_connection_fixture()
      local enabled = fixture.connection.agent.cursor_observer ~= nil
      fixture.connection:close()
      equal(enabled, value == "1")
    end
    vim.env.JANVIM_EXHIBITION_CURSOR_OBSERVER = "0"
    local explicit = new_connection_fixture({ cursor_observer = true })
    local enabled = explicit.connection.agent.cursor_observer ~= nil
    explicit.connection:close()
    equal(enabled, true)
  end, debug.traceback)
  vim.env.JANVIM_EXHIBITION_CURSOR_OBSERVER = previous
  if not ok then error(err, 0) end
end)

run("init keeps one cursor write in flight and ACKs never wait for its completion", function()
  local clock = fake_clock()
  local fixture = new_connection_fixture({ cursor_observer = true, now = clock.now, defer = clock.defer })
  local function send(value)
    fixture.fake_tcp.reader(nil, vim.json.encode(value) .. "\n")
    clock:drain()
  end
  send(command("wire-prepare", { type = "prepare", poem = POEM, expectedSha256 = POEM_HASH }))
  assert(fixture.writes[2].callback)(nil)
  send(command("wire-move-1", { type = "move", keys = "l", ["repeat"] = 1 }))
  equal(#fixture.writes, 4, "cursor and ACK must both be written before observer write completion")
  local observation = vim.json.decode(fixture.writes[3].payload)
  equal(observation.type, "cursor")
  equal(observation.cellCol, 2)
  expect(#fixture.writes[3].payload - 1 <= 1024, "cursor exceeded wire budget")
  equal(vim.json.decode(fixture.writes[4].payload).outcome, "applied")
  assert(fixture.writes[4].callback)(nil)
  clock.ms = 125
  send(command("wire-move-2", { type = "move", keys = "l", ["repeat"] = 1 }))
  equal(#fixture.writes, 5, "congestion must discard the second observation")
  equal(vim.json.decode(fixture.writes[5].payload).cueId, "wire-move-2")
  assert(fixture.writes[5].callback)(nil)
  clock.ms = 750
  assert(fixture.writes[3].callback)(nil)
  equal(#fixture.writes, 5, "congestion release must not replay an old observation")
  fixture.fake_tcp.queue_size = 1
  send(command("wire-move-3", { type = "move", keys = "l", ["repeat"] = 1 }))
  equal(#fixture.writes, 6, "transport backpressure must discard observation")
  assert(fixture.writes[6].callback)(nil)
  fixture.fake_tcp.queue_size = 0
  clock.ms = 875
  send(command("wire-move-4", { type = "move", keys = "l", ["repeat"] = 1 }))
  equal(vim.json.decode(fixture.writes[7].payload).type, "cursor")
  equal(vim.json.decode(fixture.writes[8].payload).outcome, "applied")
  fixture.connection:close()
  assert(fixture.writes[7].callback)("late callback")
  clock:drain()
  equal(#fixture.writes, 8)
  equal(fixture.connection:diagnostics().queuedCommands, 0)
end)

run("init observational write failures leave the command and transport usable", function()
  local clock = fake_clock()
  local fixture = new_connection_fixture({ cursor_observer = true, now = clock.now,
    defer = clock.defer, fail_cursor_write = true })
  fixture.fake_tcp.reader(nil, vim.json.encode(command("failure-prepare", {
    type = "prepare", poem = POEM, expectedSha256 = POEM_HASH })) .. "\n")
  assert(fixture.writes[2].callback)(nil)
  fixture.fake_tcp.reader(nil, vim.json.encode(command("failure-move", {
    type = "move", keys = "l", ["repeat"] = 1 })) .. "\n")
  clock:drain()
  equal(vim.json.decode(fixture.writes[3].payload).outcome, "applied")
  equal(vim.json.decode(fixture.writes[3].payload).cursor.col, 3)
  assert(fixture.writes[3].callback)(nil)
  equal(fixture.fake_tcp.closed, false)
  fixture.connection:close()
end)

run("init uses the full JanVim viewport on the dark theme", function()
  vim.g.janvim_margin_left = nil
  vim.g.janvim_margin_right = nil
  vim.g.janvim_enable_art_mode = nil

  local fixture = new_connection_fixture()
  equal(vim.g.janvim_margin_left, 0.0)
  equal(vim.g.janvim_margin_right, 0.0)
  equal(vim.g.janvim_enable_art_mode, false)
  fixture.connection:close()
end)

run("shutdown flushes its ack before one orphan backend exit", function()
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_pid = 7628,
    parent_alive = function(pid)
      equal(pid, 7628)
      return false
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command("cue-shutdown", { type = "shutdown" })) .. "\n")
  equal(#fixture.writes, 2)
  local acknowledgement = vim.json.decode(fixture.writes[2].payload)
  equal(acknowledgement.schema, 1)
  equal(acknowledgement.cueId, "cue-shutdown")
  equal(acknowledgement.outcome, "applied")
  equal(exit_count, 0)
  expect(not fixture.fake_tcp.closed, "transport closed before the ACK write completed")

  local complete_write = assert(fixture.writes[2].callback)
  complete_write(nil)
  equal(exit_count, 1)
  expect(fixture.fake_tcp.closed, "transport remained open after the ACK write completed")

  complete_write(nil)
  equal(exit_count, 1)
  fixture.connection:close()
end)

run("shutdown default backend exit uses the valid qall command", function()
  local commands = {}
  local original_cmd = vim.cmd
  vim.cmd = function(command_text)
    table.insert(commands, command_text)
  end
  local fixture
  local ok, err = xpcall(function()
    fixture = new_connection_fixture({
      use_default_exit_backend = true,
      parent_alive = function()
        return false
      end,
    })

    fixture.fake_tcp.reader(nil, vim.json.encode(command(
      "cue-default-backend-exit",
      { type = "shutdown" }
    )) .. "\n")
    assert(fixture.writes[2].callback)(nil)
  end, debug.traceback)
  vim.cmd = original_cmd
  if not ok then
    error(err, 0)
  end

  equal(commands, { "qall!" })
  assert(fixture).connection:close()
end)

run("shutdown rechecks a briefly live parent and exits once after ESRCH", function()
  local probes = { true, false }
  local probe_count = 0
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_alive = function(pid)
      equal(pid, 7628)
      probe_count = probe_count + 1
      return probes[probe_count]
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command(
    "cue-parent-race-shutdown",
    { type = "shutdown" }
  )) .. "\n")
  assert(fixture.writes[2].callback)(nil)

  equal(probe_count, 1)
  equal(exit_count, 0)
  equal(#fixture.deferred, 1)
  equal(fixture.deferred[1].delay_ms, 100)

  local recheck = fixture.deferred[1].callback
  recheck()
  equal(probe_count, 2)
  equal(exit_count, 1)
  equal(#fixture.deferred, 1)

  recheck()
  equal(probe_count, 2)
  equal(exit_count, 1)
  equal(#fixture.deferred, 1)
  fixture.connection:close()
end)

run("shutdown bounds a live parent to twenty deferred rechecks", function()
  local probe_count = 0
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_alive = function()
      probe_count = probe_count + 1
      return true
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command(
    "cue-live-parent-bounded-shutdown",
    { type = "shutdown" }
  )) .. "\n")
  local complete_write = assert(fixture.writes[2].callback)
  complete_write(nil)
  complete_write(nil)
  equal(probe_count, 1)
  equal(#fixture.deferred, 1)

  for recheck_index = 1, 20 do
    equal(#fixture.deferred, recheck_index)
    equal(fixture.deferred[recheck_index].delay_ms, 100)
    fixture.deferred[recheck_index].callback()
    equal(probe_count, recheck_index + 1)
    equal(exit_count, 0)
  end

  equal(#fixture.deferred, 20)
  fixture.deferred[20].callback()
  equal(probe_count, 21)
  equal(exit_count, 0)
  fixture.connection:close()
end)

run("shutdown keeps synchronous duplicate defers within the parent probe bound", function()
  local probe_count = 0
  local defer_count = 0
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_alive = function()
      probe_count = probe_count + 1
      return true
    end,
    defer = function(callback, delay_ms)
      equal(delay_ms, 100)
      defer_count = defer_count + 1
      callback()
      callback()
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command(
    "cue-synchronous-defer-shutdown",
    { type = "shutdown" }
  )) .. "\n")
  assert(fixture.writes[2].callback)(nil)

  equal(probe_count, 21)
  equal(defer_count, 20)
  equal(exit_count, 0)
  fixture.connection:close()
end)

run("shutdown cancels a pending parent recheck after connection disposal", function()
  local probe_count = 0
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_alive = function()
      probe_count = probe_count + 1
      return true
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command(
    "cue-disposed-parent-recheck-shutdown",
    { type = "shutdown" }
  )) .. "\n")
  assert(fixture.writes[2].callback)(nil)
  equal(probe_count, 1)
  equal(#fixture.deferred, 1)

  fixture.connection:close()
  fixture.deferred[1].callback()
  equal(probe_count, 1)
  equal(#fixture.deferred, 1)
  equal(exit_count, 0)
end)

run("shutdown rechecks uncertain parent probes until ESRCH", function()
  local cases = {
    {
      name = "nil result",
      first_probe = function()
        return nil
      end,
    },
    {
      name = "thrown probe",
      first_probe = function()
        error("injected transient parent probe failure")
      end,
    },
  }

  for _, case in ipairs(cases) do
    local probe_count = 0
    local exit_count = 0
    local fixture = new_connection_fixture({
      parent_alive = function()
        probe_count = probe_count + 1
        if probe_count == 1 then
          return case.first_probe()
        end
        return false
      end,
      exit_backend = function()
        exit_count = exit_count + 1
      end,
    })

    fixture.fake_tcp.reader(nil, vim.json.encode(command(
      "cue-uncertain-parent-shutdown-" .. case.name,
      { type = "shutdown" }
    )) .. "\n")
    assert(fixture.writes[2].callback)(nil)
    equal(probe_count, 1, case.name)
    equal(exit_count, 0, case.name)
    equal(#fixture.deferred, 1, case.name)

    fixture.deferred[1].callback()
    equal(probe_count, 2, case.name)
    equal(exit_count, 1, case.name)
    fixture.connection:close()
  end
end)

run("shutdown exits only when the default parent probe proves ESRCH", function()
  local cases = {
    {
      name = "live parent",
      kill = function()
        return 0
      end,
      expected_exit_count = 0,
      expected_deferred_count = 1,
    },
    {
      name = "absent parent",
      kill = function()
        return nil, "ESRCH: no such process", "ESRCH"
      end,
      expected_exit_count = 1,
      expected_deferred_count = 0,
    },
    {
      name = "permission denied",
      kill = function()
        return nil, "EPERM: operation not permitted", "EPERM"
      end,
      expected_exit_count = 0,
      expected_deferred_count = 1,
    },
    {
      name = "probe threw",
      kill = function()
        error("injected parent probe failure")
      end,
      expected_exit_count = 0,
      expected_deferred_count = 1,
    },
  }

  for _, case in ipairs(cases) do
    local exit_count = 0
    local fixture = new_connection_fixture({
      kill = case.kill,
      exit_backend = function()
        exit_count = exit_count + 1
      end,
    })
    fixture.fake_tcp.reader(nil, vim.json.encode(command(
      "cue-default-parent-probe-" .. case.name,
      { type = "shutdown" }
    )) .. "\n")
    assert(fixture.writes[2].callback)(nil)
    equal(exit_count, case.expected_exit_count, case.name)
    equal(#fixture.deferred, case.expected_deferred_count, case.name)
    equal(fixture.fake_tcp.close_count, 1, case.name)
    fixture.connection:close()
  end
end)

run("shutdown keeps a live-parent backend for normal HWND teardown", function()
  local exit_count = 0
  local fixture = new_connection_fixture({
    parent_alive = function()
      return true
    end,
    exit_backend = function()
      exit_count = exit_count + 1
    end,
  })

  fixture.fake_tcp.reader(nil, vim.json.encode(command("cue-live-parent-shutdown", { type = "shutdown" })) .. "\n")
  equal(#fixture.writes, 2)
  expect(not fixture.fake_tcp.closed, "transport closed before the live-parent ACK write completed")
  assert(fixture.writes[2].callback)(nil)
  equal(fixture.fake_tcp.close_count, 1)
  equal(exit_count, 0)
  fixture.connection:close()
end)

run("init connects only to loopback, frames commands, and closes overlong input", function()
  local dispatched = {}
  local wrap_count = 0
  local fake_agent = { disposed = false }
  function fake_agent:dispatch(value, callback)
    table.insert(dispatched, value.cueId)
    callback({
      schema = 1,
      loopId = value.loopId,
      cueId = value.cueId,
      outcome = "applied",
      mode = "n",
      cursor = { row = 0, col = 0 },
      bufferSha256 = POEM_HASH,
    })
  end
  function fake_agent:dispose()
    self.disposed = true
  end

  local fixture = new_connection_fixture({
    agent = fake_agent,
    schedule_wrap = function(callback)
      wrap_count = wrap_count + 1
      return callback
    end,
  })

  equal(fixture.fake_timer.stopped, true)
  equal(fixture.fake_timer.closed, true)
  local hello = vim.json.decode(fixture.writes[1].payload)
  equal(hello, { schema = 1, type = "hello", token = TOKEN })
  expect(wrap_count >= 2, "uv callbacks were not schedule-wrapped")

  local first_line = vim.json.encode(command("cue-wire-1", { type = "status" })) .. "\n"
  local second_line = vim.json.encode(command("cue-wire-2", { type = "status" })) .. "\n"
  local combined = first_line .. second_line
  local reader = assert(fixture.fake_tcp.reader)
  reader(nil, combined:sub(1, 11))
  reader(nil, combined:sub(12))

  equal(dispatched, { "cue-wire-1" })
  assert(fixture.writes[2].callback)(nil)
  equal(dispatched, { "cue-wire-1", "cue-wire-2" })
  equal(#fixture.writes, 3)
  equal(vim.json.decode(fixture.writes[2].payload), {
    schema = 1,
    loopId = "loop-agent",
    cueId = "cue-wire-1",
    outcome = "applied",
    mode = "n",
    cursor = { row = 0, col = 0 },
    bufferSha256 = POEM_HASH,
  })

  reader(nil, string.rep("a", 4097))
  equal(fixture.fake_tcp.closed, true)
  equal(fixture.connection:diagnostics().queuedCommands, 0)
  fixture.connection:close()
  equal(fake_agent.disposed, true)
end)

if failures > 0 then
  vim.cmd("cquit 1")
else
  vim.cmd("qa!")
end
