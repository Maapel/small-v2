# 1. Global sequential setup
global_start = 100
modifier = 2

 # 3. Nested definition (Depth 1)
def apply_step(val):
    # 4. Deeply nested definition (Depth 2)
    def limiter(x):
        # Uses closure variable 'modifier' from global scope
        return x * modifier
        
    # Mixed sequential + nested call
    temp = val + step_size
    return limiter(temp)
    
def complex_calculator(start_val):
    # 2. Local sequential setup
    current = start_val
    step_size = 10
    
   

    # 5. Intermixed local sequence and calls
    step1 = apply_step(current)
    print(step1)  # Expect: (100 + 10) * 2 = 220
    
    current = step1 + 5 # Sequence matters here!
    
    final = apply_step(current) # Expect: (225 + 10) * 2 = 470
    return final

# 6. Global sequential execution
result = complex_calculator(global_start)
print(result)
