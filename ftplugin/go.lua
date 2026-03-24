-- Go ftplugin configuration
-- Sensible defaults following Go conventions

local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = false
opt.list = false

opt.commentstring = "// %s"

opt.foldmethod = "syntax"
opt.foldlevel = 99

opt.textwidth = 100
opt.colorcolumn = "101"

opt.formatoptions:append("jcroql")

opt.smartindent = false
opt.autoindent = true

local opts = { buffer = true, silent = true }

map("n", "<leader>df", "ofunc () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>dm", "ofunc () () {<cr>}<esc>k^2f(i", opts)

map("n", "<leader>st", "otype  struct {<cr>}<esc>k^ela", opts)

map("n", "<leader>in", "otype  interface {<cr>}<esc>k^ela", opts)

map("n", "<leader>ie", "oif err != nil {<cr>return err<cr>}<esc>2k^", opts)

map("n", "<leader>iw", 'oif err != nil {<cr>return fmt.Errorf(": %w", err)<cr>}<esc>2k^f"l', opts)

map("n", "<leader>gr", "iggo func() {<cr>}()<esc>", opts)

map("n", "<leader>ch", "i <- <esc>hi", opts)

map("n", "<leader>df", "odefer ()<esc>F(i", opts)

map("n", "<leader>pr", 'odefer func() {<cr>if r := recover(); r != nil {<cr>fmt.Println("Recovered:", r)<cr>}<cr>}()<esc>', opts)

map("n", "<leader>rg", "ofor _,  := range  {<cr>}<esc>k^f,a", opts)

map("n", "<leader>fo", "ofor i := 0; i < ; i++ {<cr>}<esc>k^f<la", opts)

map("n", "<leader>sw", "oswitch  {<cr>case :<cr>default:<cr>}<esc>3k^ela", opts)

map("n", "<leader>sl", "oselect {<cr>case <-:<cr>default:<cr>}<esc>3k^", opts)

map("n", "<leader>ga", "oggo func() {<cr>}()<esc>O", opts)

map("n", "<leader>im", 'oimport (<cr>""<cr>)<esc>k^f"a', opts)

map("n", "<leader>pd", 'yiwofmt.Printf("%+v\\n", )<esc>F,la', opts)
map("v", "<leader>pd", 'yofmt.Printf("%+v\\n", <c-r>")<esc>', opts)

map("n", "<leader>pt", 'yiwofmt.Printf("%T\\n", )<esc>F,la', opts)

map("n", "<leader>jm", "odata, err := json.Marshal()<cr>if err != nil {<cr>return err<cr>}<esc>3k^", opts)

map("n", "<leader>ju", "oerr := json.Unmarshal(data, &)<esc>F&a", opts)

map("n", "<leader>ct", "octx, cancel := context.WithTimeout(context.Background(), time.Second)<cr>defer cancel()<esc>", opts)

map("n", "<leader>tf", "ofunc Test(t *testing.T) {<cr>}<esc>k^fTla", opts)

map("n", "<leader>bf", "ofunc Benchmark(b *testing.B) {<cr>for i := 0; i < b.N; i++ {<cr>}<cr>}<esc>4k^fBla", opts)
