// Webhook-based email service for Render free tier
// This uses external services that don't require SMTP

// Function to send email via webhook (using services like EmailJS, Formspree, etc.)
async function sendEmailViaWebhook(mailOptions) {
    try {
        console.log('📧 Sending email via webhook service...');
        
        // Option 1: Using EmailJS (free tier available)
        if (process.env.EMAILJS_SERVICE_ID && process.env.EMAILJS_TEMPLATE_ID && process.env.EMAILJS_PUBLIC_KEY) {
            return await sendViaEmailJS(mailOptions);
        }
        
        // Option 2: Using Formspree (free tier available)
        if (process.env.FORMSPREE_ENDPOINT) {
            return await sendViaFormspree(mailOptions);
        }
        
        // Option 3: Using Netlify Forms (if deployed on Netlify)
        if (process.env.NETLIFY_FORMS_ENDPOINT) {
            return await sendViaNetlifyForms(mailOptions);
        }
        
        throw new Error('No webhook email service configured');
        
    } catch (error) {
        console.error('❌ Webhook email service failed:', error.message);
        throw error;
    }
}

// EmailJS integration
async function sendViaEmailJS(mailOptions) {
    const emailjsData = {
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: {
            to_email: mailOptions.to,
            from_name: 'AJK Cleaning Company',
            from_email: process.env.ADMIN_EMAIL,
            subject: mailOptions.subject,
            message: mailOptions.text || mailOptions.html,
            reply_to: process.env.ADMIN_EMAIL
        }
    };
    
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailjsData)
    });
    
    if (!response.ok) {
        throw new Error(`EmailJS failed: ${response.statusText}`);
    }
    
    console.log('✅ Email sent via EmailJS');
    return true;
}

// Formspree integration
async function sendViaFormspree(mailOptions) {
    const formspreeData = {
        email: mailOptions.to,
        subject: mailOptions.subject,
        message: mailOptions.text || mailOptions.html,
        _replyto: process.env.ADMIN_EMAIL,
        _cc: process.env.ADMIN_EMAIL
    };
    
    const response = await fetch(process.env.FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(formspreeData)
    });
    
    if (!response.ok) {
        throw new Error(`Formspree failed: ${response.statusText}`);
    }
    
    console.log('✅ Email sent via Formspree');
    return true;
}

// Netlify Forms integration
async function sendViaNetlifyForms(mailOptions) {
    const netlifyData = {
        'form-name': 'email-notification',
        'to': mailOptions.to,
        'subject': mailOptions.subject,
        'message': mailOptions.text || mailOptions.html,
        'from': process.env.ADMIN_EMAIL
    };
    
    const response = await fetch(process.env.NETLIFY_FORMS_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(netlifyData)
    });
    
    if (!response.ok) {
        throw new Error(`Netlify Forms failed: ${response.statusText}`);
    }
    
    console.log('✅ Email sent via Netlify Forms');
    return true;
}

module.exports = {
    sendEmailViaWebhook,
    sendViaEmailJS,
    sendViaFormspree,
    sendViaNetlifyForms
};
