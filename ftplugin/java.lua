local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = true

opt.commentstring = "// %s"

opt.foldmethod = "syntax"
opt.foldlevel = 99

opt.textwidth = 120
opt.colorcolumn = "121"

opt.formatoptions:append("jcroql")

opt.autoindent = true
opt.smartindent = false

opt.cindent = true

opt.errorformat = "%A%f:%l:%c: %t%*[^:]: %m"

local opts = { buffer = true, silent = true }

map("n", "<leader>cm", "opublic class  {<cr>}<esc>k^f{i", opts)

map("n", "<leader>im", "opublic interface  {<cr>}<esc>k^f{i", opts)

map("n", "<leader>dm", "opublic void () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>dm", "opublic static void () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>dm", "opublic void set() {<cr>}<esc>k^f(i", opts)

map("n", "<leader>dm", "opublic  get() {<cr>return ;<cr>}<esc>2k^f(i", opts)

map("n", "<leader>cm", "opublic () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>cm", "oprivate () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fo", "ofor (int i = 0; i < ; i++) {<cr>}<esc>k^f<la", opts)

map("n", "<leader>fe", "ofor ( : ) {<cr>}<esc>k^f:a", opts)

map("n", "<leader>wh", "owhile () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>wh", "odo {<cr>} while ();<esc>k^f(i", opts)

map("n", "<leader>sw", "oswitch () {<cr>case :<cr>break;<cr>default:<cr>break;<cr>}<esc>4k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>} else {<cr>}<esc>2k^f(i", opts)

map("n", "<leader>tr", "otry {<cr>} catch (Exception e) {<cr>e.printStackTrace();<cr>}<esc>3k^", opts)

map("n", "<leader>tr", "otry {<cr>} catch (Exception e) {<cr>e.printStackTrace();<cr>} finally {<cr>}<esc>4k^", opts)

map("n", "<leader>sy", "osynchronized () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>sy", "osynchronized (this) {<cr>}<esc>k^", opts)

map("n", "<leader>pr", "oSystem.out.println();<esc>hi", opts)

map("n", "<leader>pr", "oSystem.out.println(\"\");<esc>2hi", opts)

map("n", "<leader>pr", "oSystem.out.printf(\"\\n\", );<esc>2F,la", opts)

map("n", "<leader>st", "oString <esc>a", opts)

map("n", "<leader>st", "oList<>  = new ArrayList<>();<esc>F<a", opts)

map("n", "<leader>mp", "oMap<, >  = new HashMap<>();<esc>F<a", opts)

map("n", "<leader>st", "oSet<>  = new HashSet<>();<esc>F<a", opts)

map("n", "<leader>im", "oimport ;<esc>ha", opts)

map("n", "<leader>im", "oimport java.util.*;<esc>", opts)

map("n", "<leader>im", "oimport java.io.*;<esc>", opts)

map("n", "<leader>an", "o@Override<cr>public  () {<cr>}<esc>2k^f(i", opts)

map("n", "<leader>th", "o@Test<cr>public void () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>bf", "o@Before<cr>public void setUp() {<cr>}<esc>", opts)

map("n", "<leader>af", "o@After<cr>public void tearDown() {<cr>}<esc>", opts)

map("n", "<leader>as", "oassertEquals(, );<esc>F,la", opts)

map("n", "<leader>as", "oassertTrue();<esc>hi", opts)

map("n", "<leader>as", "oassertNotNull();<esc>hi", opts)
