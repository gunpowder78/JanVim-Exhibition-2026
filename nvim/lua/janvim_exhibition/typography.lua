local Typography = {}

local SETTINGS = {
  conceal_level = 2,
  conceal_cursor = "nvic",
  punctuation = {
    { group = "JanVimCompactComma", source = "，", replacement = "﹐" },
    { group = "JanVimCompactFullStop", source = "。", replacement = "﹒" },
    { group = "JanVimCompactSemicolon", source = "；", replacement = "﹔" },
    { group = "JanVimCompactColon", source = "：", replacement = "﹕" },
    { group = "JanVimCompactQuestion", source = "？", replacement = "﹖" },
    { group = "JanVimCompactExclamation", source = "！", replacement = "﹗" },
    { group = "JanVimCompactEnumeration", source = "、", replacement = "﹑" },
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
  vim.wo.conceallevel = SETTINGS.conceal_level
  vim.wo.concealcursor = SETTINGS.conceal_cursor

  for _, mapping in ipairs(SETTINGS.punctuation) do
    vim.cmd(string.format(
      "syntax match %s /\\V%s/ conceal cchar=%s containedin=ALL",
      mapping.group,
      mapping.source,
      mapping.replacement
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
end

return Typography
