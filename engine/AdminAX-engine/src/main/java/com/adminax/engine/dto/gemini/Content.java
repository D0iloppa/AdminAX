/**
 * 
 */
package com.adminax.engine.dto.gemini;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
public class Content {
    @JsonProperty("role")
    private String role;

    @JsonProperty("parts")
    private List<Part> parts;

    public Content() {}
    public Content(String role, List<Part> parts) {
        this.role = role;
        this.parts = parts;
    }
    
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public List<Part> getParts() { return parts; }
    public void setParts(List<Part> parts) { this.parts = parts; }
}
