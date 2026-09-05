-- Test entry only: real Neovim, immutable JanVim module and candidate production agent.
-- Invoked with -u NONE -i NONE --noplugin --headless; never reads a user init.
local runtime_root = assert(vim.env.JANVIM_EXHIBITION_NVIM_ROOT, "test runtime root is required")
vim.opt.runtimepath:prepend(runtime_root)
vim.opt.runtimepath:prepend(vim.fn.fnamemodify(runtime_root, ":h") .. "/runtime/janvim/runtime")

local connection = require("janvim_exhibition").setup()
local agent = connection.agent
local dispatch = agent.dispatch
local finished = false
local snapshots = 0

-- Observe real buffer reads alongside the normal ACK. No replacement actions,
-- cursor events, clock, transport, JanVim module or sound features are supplied.
function agent:dispatch(command, callback)
  dispatch(self, command, function(ack)
    snapshots = snapshots + 1
    assert(snapshots <= 32, "fixture snapshot bound exceeded")
    local buffer = assert(self:buffer_number(), "show scratch buffer missing")
    io.stdout:write("REAL_CURSOR_BUFFER " .. vim.json.encode({
      cueId = command.cueId,
      text = table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, true), "\n"),
    }) .. "\n")
    io.stdout:flush()
    callback(ack)
    if command.action.type == "shutdown" then finished = true end
  end)
end

assert(vim.wait(45000, function() return finished end, 5), "fixture deadline exceeded")
-- Let the production shutdown flush its ACK before the test closes the backend.
assert(vim.wait(1000, function() return connection.transport_closed end, 5), "shutdown ACK did not flush")
connection:close()
vim.cmd("qa!")
