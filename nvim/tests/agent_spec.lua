local runtime_root = assert(vim.env.JANVIM_EXHIBITION_NVIM_ROOT, "test runtime root is required")
vim.opt.runtimepath:prepend(runtime_root)

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
  equal(vim.api.nvim_buf_get_name(buffer_number), "")
  equal(buffer_text(buffer_number), POEM)

  local unchanged = assert(io.open(source_path, "rb"))
  equal(unchanged:read("*a"), "SOURCE-SENTINEL")
  unchanged:close()
  vim.fn.delete(source_path)
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
    table.insert(writes, { payload = payload, callback = callback })
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

  local connection = exhibition.setup({
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
    exit_backend = options.exit_backend or function() end,
  })

  return {
    connection = connection,
    fake_tcp = fake_tcp,
    fake_timer = fake_timer,
    writes = writes,
    deferred = deferred,
  }
end

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
