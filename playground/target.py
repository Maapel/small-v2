            # Reads 'modifier' from global scope (2 levels up)
# 1. Global sequential setup
global_start = 100
modifier = 2
    
def complex_calculator(start_val):
    # 2. Local sequential setup
    current = start_val
    step_size = 10 # <--- 'step_size' is local to complex_calculator

    # 3. Nested definition (Depth 1)
    #    'apply_step' is NOW INSIDE complex_calculator
    def apply_step(val):
        # 4. Deeply nested definition (Depth 2)
        def limiter(x):
            return x * modifier
            
        # Reads 'step_size' from parent scope (1 level up)
        temp = val + step_size 
        return limiter(temp)

    # 5. Intermixed local sequence and calls
    step1 = apply_step(current)
    print(step1) 
    
    current = step1 + 5 # Sequence matters here!
    
    final = apply_step(current)
    return final

# 6. Global sequential execution
result = complex_calculator(global_start)
print(result)