-- Python ftplugin configuration
-- Sensible defaults following PEP 8 conventions

local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = true

opt.commentstring = "# %s"

opt.foldmethod = "indent"
opt.foldlevel = 99
opt.foldnestmax = 2

opt.textwidth = 88
opt.colorcolumn = "89"

opt.formatoptions:append("jcroql")

opt.autoindent = true
opt.smartindent = false

vim.g.python_folding = 1

local opts = { buffer = true, silent = true }

map("n", "<leader>df", "odef ():<cr>    pass<esc>k^f(i", opts)

map("n", "<leader>dm", "odef (self):<cr>    pass<esc>k^f(i", opts)

map("n", "<leader>dc", "oclass :<cr>    def __init__(self):<cr>        pass<esc>3k^f:a", opts)

map("n", "<leader>dd", "o@dataclass<cr>class :<cr>    pass<esc>2k^f:a", opts)

map("n", "<leader>te", "otry:<cr>    pass<cr>except Exception as e:<cr>    print(f\'Error: {e}\')<esc>3k^", opts)

map("n", "<leader>tf", "otry:<cr>    pass<cr>except Exception as e:<cr>    print(f\'Error: {e}\')<cr>finally:<cr>    pass<esc>4k^", opts)

map("n", "<leader>mn", "oif __name__ == \'__main__\':<cr>    main()<esc>", opts)

map("v", "<leader>lc", 'yo[<c-r>" for  in <c-r>"]<esc>f[a', opts)

map("v", "<leader>dc", 'yo{<c-r>":  for  in <c-r>"}<esc>f{a', opts)

map("v", "<leader>fs", 'yf"<c-r>"<esc>', opts)

map("n", "<leader>pd", "yiwoprint(f\'{repr()}\')<esc>F{li", opts)
map("v", "<leader>pd", "yoprint(f\'{repr()}\')<esc>F{li", opts)

map("n", "<leader>im", "ggOimport <esc>oimport <esc>k^A", opts)

map("n", "<leader>fi", "ifrom  import <esc>^ela", opts)

map("n", "<leader>th", "i: <esc>a", opts)

map("n", "<leader>tr", "i -> <esc>a", opts)

map("n", "<leader>ds", 'o"""""""""<esc>O', opts)
