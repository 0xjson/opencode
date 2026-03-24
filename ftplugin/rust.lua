-- Rust ftplugin configuration
-- Sensible defaults following Rust conventions

local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = true

opt.commentstring = "// %s"

opt.foldmethod = "syntax"
opt.foldlevel = 99

opt.textwidth = 100
opt.colorcolumn = "101"

opt.formatoptions:append("jcroql")

opt.smartindent = true
opt.autoindent = true

local opts = { buffer = true, silent = true }

map("n", "<leader>df", "ofn () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>pf", "opub fn () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>af", "oasync fn () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>st", "ostruct  {<cr>}<esc>k^ela", opts)

map("n", "<leader>en", "oenum  {<cr>}<esc>k^ela", opts)

map("n", "<leader>im", "oimpl  {<cr>}<esc>k^ela", opts)

map("n", "<leader>it", "oimpl  for  {<cr>}<esc>k^f fha", opts)

map("n", "<leader>tr", "otrait  {<cr>}<esc>k^ela", opts)

map("n", "<leader>ma", "omatch  {<cr>_ => ,<cr>}<esc>2k^ela", opts)

map("n", "<leader>il", "oif let  =  {<cr>}<esc>k^f=a", opts)

map("n", "<leader>wl", "owhile let  =  {<cr>}<esc>k^f=a", opts)

map("n", "<leader>fo", "ofor  in  {<cr>}<esc>k^fi", opts)

map("n", "<leader>re", "omatch  {<cr>Ok(val) => val,<cr>Err(e) => return Err(e.into()),<cr>}<esc>3k^ela", opts)

map("n", "<leader>op", "omatch  {<cr>Some(val) => val,<cr>None => return None,<cr>}<esc>3k^ela", opts)

map("n", "<leader>qu", "a?<esc>", opts)

map("n", "<leader>de", "ggO#[derive()]<esc>f)i", opts)

map("n", "<leader>db", "ggO#[derive(Debug)]<esc>o", opts)

map("n", "<leader>dc", "ggO#[derive(Clone, Copy)]<esc>o", opts)

map("n", "<leader>us", "iuse ;<esc>hi", opts)

map("n", "<leader>mo", "imod ;<esc>hi", opts)

map("n", "<leader>pm", "opub mod ;<esc>hi", opts)

map("n", "<leader>pd", 'yiwoprintln!("{:?}", );<esc>F,la', opts)

map("n", "<leader>pp", 'yiwoprintln!("{:#?}", );<esc>F,la', opts)

map("n", "<leader>pl", 'iprintln!("");<esc>F"i', opts)

map("n", "<leader>ep", 'ieprintln!("");<esc>F"i', opts)

map("n", "<leader>dg", "yiwodbg!(&);<esc>F&a", opts)
map("v", "<leader>dg", 'yodbg!(&<c-r>");<esc>', opts)

map("n", "<leader>td", "itodo!();<esc>F(i", opts)

map("n", "<leader>un", "a.unwrap()<esc>", opts)
map("n", "<leader>ex", 'a.expect("")<esc>F"i', opts)

map("n", "<leader>cl", "a.clone()<esc>", opts)

map("n", "<leader>in", "a.into()<esc>", opts)
map("n", "<leader>fr", "a.from()<esc>", opts)

map("n", "<leader>ts", "a.to_string()<esc>", opts)

map("n", "<leader>tf", "o#[test]<cr>fn test_() {<cr>}<esc>k^f_la", opts)

map("n", "<leader>at", "o#[tokio::test]<cr>async fn test_() {<cr>}<esc>k^f_la", opts)

map("n", "<leader>tm", "o#[cfg(test)]<cr>mod tests {<cr>use super::*;<cr><cr>#[test]<cr>fn test_() {<cr>}<cr>}<esc>4k^f_la", opts)

map("n", "<leader>us", "ounsafe {<cr>}<esc>O", opts)

map("n", "<leader>cf", "oconst fn () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>sl", "a&'static <esc>", opts)

map("n", "<leader>rt", "iResult<, Box<dyn std::error::Error>><esc>F<a", opts)

map("n", "<leader>ve", "ivec![]<esc>i", opts)

map("n", "<leader>fm", 'iformat!("");<esc>F"i', opts)
