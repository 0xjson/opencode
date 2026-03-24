-- Markdown ftplugin configuration
-- Sensible defaults for writing documentation

local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 2
opt.tabstop = 2
opt.softtabstop = 2
opt.expandtab = true

opt.commentstring = "<!-- %s -->"

opt.foldmethod = "marker"
opt.foldlevel = 0

opt.textwidth = 80
opt.colorcolumn = "81"

opt.formatoptions:append("tcrqnlj")
opt.formatoptions:remove("o")

opt.wrap = true
opt.linebreak = true
opt.breakat = " ^I!@*-+;:,./?"
opt.showbreak = "↪ "

opt.conceallevel = 2

opt.spell = true
opt.spelllang = "en"

vim.g.markdown_syntax_conceal = 1
vim.g.markdown_fenced_languages = {
  "bash",
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "lua",
  "json",
  "yaml",
  "vim",
  "html",
  "css",
  "sql",
}

local opts = { buffer = true, silent = true }

map("n", "<leader>h1", "yypVr=<esc>", opts)
map("n", "<leader>h2", "yypVr-<esc>", opts)
map("n", "<leader>h3", "i### <esc>A", opts)
map("n", "<leader>h4", "i#### <esc>A", opts)
map("n", "<leader>h5", "i##### <esc>A", opts)
map("n", "<leader>h6", "i###### <esc>A", opts)

map("v", "<leader>b", "S*gvS*<esc>", opts)
map("n", "<leader>b", "ysiw*ysiw*<esc>", opts)

map("v", "<leader>i", "S*<esc>", opts)
map("n", "<leader>i", "ysiw*<esc>", opts)

map("v", "<leader>c", "S`<esc>", opts)
map("n", "<leader>c", "ysiw`<esc>", opts)

map("n", "<leader>cb", "i```<cr>```<esc>O", opts)

map("n", "<leader>cl", "i```<cr>```<esc>kA", opts)

map("v", "<leader>l", "S]f]a()<esc>i", opts)
map("n", "<leader>l", "ysiw]f]a()<esc>i", opts)

map("n", "<leader>im", "i![]()<esc>2F[la", opts)

map("n", "<leader>hr", "o---<cr><esc>", opts)

map("n", "<leader>bq", "I> <esc>", opts)
map("v", "<leader>bq", "S><esc>", opts)

map("n", "<leader>ul", "I- <esc>", opts)
map("v", "<leader>ul", "S-<esc>", opts)

map("n", "<leader>ol", "I1. <esc>", opts)

map("n", "<leader>tl", "I- [ ] <esc>", opts)

map("n", "<leader>tt", "^f[lrx<esc>", opts)
map("n", "<leader>tu", "^f[lr <esc>", opts)

map("n", "<leader>ta", "i| Header 1 | Header 2 |<cr>|----------|----------|<cr>| Cell 1   | Cell 2   |<esc>", opts)

map("n", "<leader>tr", "i|  |  |<esc>F|a", opts)

map("v", "<leader>s", "S~~<esc>", opts)

map("n", "<leader>fn", "i[^1]<cr><cr>[^1]: <esc>a", opts)

map("n", "<leader>dt", "i<C-r>=strftime('%Y-%m-%d')<cr><esc>", opts)

map("n", "<leader>tm", "i<C-r>=strftime('%H:%M:%S')<cr><esc>", opts)

map("n", "<leader>mp", "<cmd>MarkdownPreviewToggle<cr>", opts)

map("n", "<leader>toc", "i<!-- toc --><cr><!-- tocstop --><esc>", opts)

map("n", "<leader>fd", "i<!--fold--><cr><!--endfold--><esc>O", opts)

map("n", "<leader>ym", "ggO---<cr>title: <cr>date: <C-r>=strftime('%Y-%m-%d')<cr><cr>---<cr><esc>3k^A", opts)

map("n", "<leader>md", "i```mermaid<cr>graph TD;<cr>    A-->B;<cr>```<esc>3k^", opts)

map("n", "<leader>ma", "i$ $<esc>hi", opts)

map("n", "<leader>mb", "i$$<cr>$$<esc>O", opts)

map("n", "<leader>wc", "g<C-g>", opts)
