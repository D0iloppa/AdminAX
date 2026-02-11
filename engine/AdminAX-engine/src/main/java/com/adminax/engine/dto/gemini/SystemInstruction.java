/**
 * 
 */
package com.adminax.engine.dto.gemini;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
public class SystemInstruction {
    @JsonProperty("parts")
    private List<Part> parts;

    public SystemInstruction() {}
    public SystemInstruction(List<Part> parts) { this.parts = parts; }
    public List<Part> getParts() { return parts; }
    public void setParts(List<Part> parts) { this.parts = parts; }
}
