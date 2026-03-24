-- TypeScript ftplugin configuration
-- Sensible defaults following TS community conventions

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

map("n", "<leader>td", "itype  = ;<esc>F=ha", opts)

map("n", "<leader>if", "ointerface  {<cr>}<esc>k^ela", opts)

map("n", "<leader>ta", "otype  = ;<esc>F=ha", opts)

map("n", "<leader>gf", "ifunction <>(arg: ):  {<cr>}<esc>3k^f<a", opts)

map("n", "<leader>af", "iconst  = ():  => {<cr>};<esc>2k^ela", opts)

map("n", "<leader>as", "iasync function (): Promise<> {<cr>}<esc>k^fPia", opts)

map("n", "<leader>tc", "otry {<cr>} catch (err: unknown) {<cr>console.error(err);<cr>}<esc>3k^", opts)

map("n", "<leader>it", "iimport type {  } from \'\';<esc>F{a", opts)

map("n", "<leader>ed", "iexport default ;<esc>a", opts)

map("n", "<leader>ec", "iexport const  = ;<esc>F=ha", opts)

map("n", "<leader>jd", "i/**  */<esc>2hi", opts)

map("n", "<leader>js", 'yiwoconsole.log(JSON.stringify(<c-r>\", null, 2));<esc>', opts)
