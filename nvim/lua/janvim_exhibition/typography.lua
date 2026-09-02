local Typography = {}
local HIGHLIGHT_NAMESPACE = vim.api.nvim_create_namespace("janvim-exhibition-typography")

local SETTINGS = {
  conceal_level = 0,
  conceal_cursor = "",
  punctuation = {
    { group = "JanVimCompactComma", source = "，" },
    { group = "JanVimCompactFullStop", source = "。" },
    { group = "JanVimCompactSemicolon", source = "；" },
    { group = "JanVimCompactColon", source = "：" },
    { group = "JanVimCompactQuestion", source = "？" },
    { group = "JanVimCompactExclamation", source = "！" },
    { group = "JanVimCompactEnumeration", source = "、" },
  },
  semantic_highlights = {
    {
      group = "JanVimEnglishTech",
      pattern = [[\c\%(entropy\|channel\|codebook\|mutual information\|information\|signal\|noise\|probability\|shannon\|kolmogorov\|protocol\|hash\|buffer\|cursor\|runtime\|reset\)]],
      highlight = "Function",
    },
    {
      group = "JanVimChineseTech",
      pattern = [[\%(信息论\|信息\|信道\|互信息\|编码\|解码\|码字\|噪声\|概率\|信号\|带宽\|冗余\|熵\|哈希\|协议\|缓冲区\|光标\)]],
      highlight = "Type",
    },
    {
      group = "JanVimLandscape",
      pattern = [[\%(山\|风\|河\|水\|楼\|云\|林\|鸟\|夜\|光\|石\|海\|雨\|星\|岸\|潮\)]],
      highlight = "String",
    },
    {
      group = "JanVimProcess",
      pattern = [[\%(记录\|校验\|冻结\|重放\|回写\|恢复\|循环\|边界\|路径\|状态\|控制器\|生成\|观察\|测量\|采样\|映射\|传输\)]],
      highlight = "Keyword",
    },
    {
      group = "JanVimNumber",
      pattern = [[\d\+]],
      highlight = "Number",
    },
    {
      group = "JanVimAcronym",
      pattern = [[\<[A-Z][A-Z0-9_-]\{1,7}\>]],
      highlight = "Constant",
    },
  },
}

function Typography.apply()
  local window_number = vim.api.nvim_get_current_win()
  vim.wo.conceallevel = SETTINGS.conceal_level
  vim.wo.concealcursor = SETTINGS.conceal_cursor
  vim.api.nvim_win_set_hl_ns(window_number, HIGHLIGHT_NAMESPACE)

  for _, mapping in ipairs(SETTINGS.punctuation) do
    vim.api.nvim_set_hl(HIGHLIGHT_NAMESPACE, mapping.group, { fg = "#b74133" })
    vim.cmd(string.format(
      "syntax match %s /\\V%s/ containedin=ALL",
      mapping.group,
      mapping.source
    ))
  end

  for _, mapping in ipairs(SETTINGS.semantic_highlights) do
    vim.cmd(string.format(
      "syntax match %s /%s/ containedin=ALL",
      mapping.group,
      mapping.pattern
    ))
    vim.cmd(string.format(
      "highlight default link %s %s",
      mapping.group,
      mapping.highlight
    ))
  end

  return window_number
end

function Typography.clear(window_number)
  if type(window_number) ~= "number" or not vim.api.nvim_win_is_valid(window_number) then
    return
  end
  if vim.api.nvim_get_hl_ns({ winid = window_number }) == HIGHLIGHT_NAMESPACE then
    vim.api.nvim_win_set_hl_ns(window_number, -1)
  end
end

return Typography
