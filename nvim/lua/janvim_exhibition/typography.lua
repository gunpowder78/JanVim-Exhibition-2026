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
end

return Typography
