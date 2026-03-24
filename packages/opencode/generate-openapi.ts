#!/usr/bin/env bun

import { Server } from "./src/server/server"

console.log("Generating OpenAPI specification...")

try {
  const spec = await Server.openapi()

  const fs = require("fs")
  const path = require("path")

  const outputPath = path.join(process.cwd(), "openapi.json")
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2))

  console.log(`✅ OpenAPI specification generated successfully!`)
  console.log(`📄 Output: ${outputPath}`)

  const pathCount = Object.keys(spec.paths || {}).length
  console.log(`🛣️  Documented paths: ${pathCount}`)

  console.log("\n📊 Summary:")
  console.log(`   - OpenAPI version: ${spec.openapi}`)
  console.log(`   - Title: ${spec.info?.title}`)
  console.log(`   - Version: ${spec.info?.version}`)
  console.log(`   - Paths: ${pathCount}`)

  if (spec.components?.schemas) {
    console.log(`   - Schemas: ${Object.keys(spec.components.schemas).length}`)
  }

  console.log("\n🛣️  Available paths:")
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    const methodList = Object.keys(methods || {}).join(", ")
    console.log(`   ${path} [${methodList}]`)
  }
} catch (error) {
  console.error("❌ Error generating OpenAPI specification:")
  console.error(error)
  process.exit(1)
}
