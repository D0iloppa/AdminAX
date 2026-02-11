/**
 * 
 */
package com.adminax.engine.dto.gemini;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
public class GenerationConfig {
    @JsonProperty("response_mime_type") //
    private String responseMimeType;

    @JsonProperty("temperature")
    private Double temperature;

    @JsonProperty("top_p") //
    private Double topP;

    @JsonProperty("max_output_tokens") //
    private Integer maxOutputTokens;

    public GenerationConfig() {}

    public GenerationConfig(String responseMimeType, Double temperature, Double topP, Integer maxOutputTokens) {
        this.responseMimeType = responseMimeType;
        this.temperature = temperature;
        this.topP = topP;
        this.maxOutputTokens = maxOutputTokens;
    }

	public String getResponseMimeType() {
		return responseMimeType;
	}

	public void setResponseMimeType(String responseMimeType) {
		this.responseMimeType = responseMimeType;
	}

	public Double getTemperature() {
		return temperature;
	}

	public void setTemperature(Double temperature) {
		this.temperature = temperature;
	}

	public Double getTopP() {
		return topP;
	}

	public void setTopP(Double topP) {
		this.topP = topP;
	}

	public Integer getMaxOutputTokens() {
		return maxOutputTokens;
	}

	public void setMaxOutputTokens(Integer maxOutputTokens) {
		this.maxOutputTokens = maxOutputTokens;
	}
    
    
}
