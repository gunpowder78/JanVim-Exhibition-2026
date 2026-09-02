local Visuals = {}

local SETTINGS = {
  margin_left = 0.08,
  margin_right = 0.12,
  enable_art_mode = false,
}

function Visuals.apply()
  local loaded, janvim = pcall(require, "janvim")
  if not loaded or type(janvim) ~= "table" or type(janvim.setup) ~= "function" then
    return nil, "janvim-visual-api-unavailable"
  end

  local applied, state = pcall(janvim.setup, vim.deepcopy(SETTINGS))
  if not applied or type(state) ~= "table" then
    return nil, "janvim-visual-setup-failed"
  end
  if state.margin_left ~= SETTINGS.margin_left
      or state.margin_right ~= SETTINGS.margin_right
      or state.enable_art_mode ~= SETTINGS.enable_art_mode then
    return nil, "janvim-visual-state-mismatch"
  end
  return state
end

return Visuals
