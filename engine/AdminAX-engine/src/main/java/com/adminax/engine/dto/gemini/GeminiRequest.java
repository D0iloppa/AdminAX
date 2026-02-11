/**
 * 
 */
package com.adminax.engine.dto.gemini;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
public class GeminiRequest {
	
	@JsonProperty("system_instruction") //
    private SystemInstruction systemInstruction;

    @JsonProperty("contents")
    private List<Content> contents;

    @JsonProperty("generation_config") //
    private GenerationConfig generationConfig;

    public GeminiRequest() {}

    public GeminiRequest(SystemInstruction systemInstruction, List<Content> contents, GenerationConfig generationConfig) {
        this.systemInstruction = systemInstruction;
        this.contents = contents;
        this.generationConfig = generationConfig;
    }

    // Getters and Setters
    public SystemInstruction getSystemInstruction() { return systemInstruction; }
    public void setSystemInstruction(SystemInstruction systemInstruction) { this.systemInstruction = systemInstruction; }
    public List<Content> getContents() { return contents; }
    public void setContents(List<Content> contents) { this.contents = contents; }
    public GenerationConfig getGenerationConfig() { return generationConfig; }
    public void setGenerationConfig(GenerationConfig generationConfig) { this.generationConfig = generationConfig; }
}
