-- JavaScript ftplugin configuration
-- Sensible defaults following JS community conventions

local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 2
opt.tabstop = 2
opt.softtabstop = 2
opt.expandtab = true

opt.commentstring = "// %s"

opt.foldmethod = "syntax"
opt.foldlevel = 99

opt.textwidth = 100
opt.colorcolumn = "101"

opt.formatoptions:append("jcroql")

opt.conceallevel = 0

opt.smartindent = true
opt.autoindent = true

local opts = { buffer = true, silent = true }

map("n", "<leader>cl", 'yiwoconsole.log(\'<c-r>"\', <c-r>");<esc>', opts)
map("v", "<leader>cl", 'yoconsole.log(\'<c-r>"\', <c-r>");<esc>', opts)

map("n", "<leader>co", "yiwoconsole.log({<c-r>\"});<esc>", opts)
map("v", "<leader>co", "yoconsole.log({<c-r>\"});<esc>", opts)

map("n", "<leader>ce", 'yiwoconsole.error(\'<c-r>"\', <c-r>");<esc>', opts)
map("v", "<leader>ce", 'yoconsole.error(\'<c-r>"\', <c-r>");<esc>', opts)

map("n", "<leader>af", "iconst  = () => {<cr>};<esc>k^ea", opts)

map("n", "<leader>as", "iasync function () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>tc", "otry {<cr>} catch (err) {<cr>console.error(err);<cr>}<esc>3k^", opts)

map("n", "<leader>js", 'yiwoconsole.log(JSON.stringify(<c-r>\", null, 2));<esc>', opts)

map("n", "<leader>im", "iimport  from \'\';<esc>F'a", opts)
