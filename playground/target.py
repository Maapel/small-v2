import os
import json

# Test function def, list/dict literals
def find_high_scorers(data, threshold):
    high_scorers = [] # Test LITERAL_LIST
    
    # Test 'for' loop (new container world)
    for item in data:
        try:
            # Test 'dict' access (ACCESSOR node)
            score = item["score"]
            
            # Test 'if' block (new container world)
            if score > threshold:
                # Test 'append' (ATTRIBUTE + CALL)
                high_scorers.append(item["name"])
        
        # Test 'except' block (new container world)
        except KeyError:
            # This print call is inside the 'except' world
            print(f"Skipping item, no 'score'")

    return high_scorers

# Test global data and function call
all_data = [
    {"name": "Alice", "score": 88},
    {"name": "Bob", "score": 95},
    {"name": "Charlie", "role": "admin"} # Test the 'except'
]

scorers = find_high_scorers(all_data, 90)

print(f"High Scorers: {scorers}")