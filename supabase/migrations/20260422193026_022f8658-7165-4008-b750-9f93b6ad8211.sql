UPDATE consultations
SET ticket_value = NULL,
    payment_method = NULL
WHERE ticket_value = 17 AND payment_method = 'pagtrust';