const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username:{type:String ,required:true},
    email: { type: String, required: true,
        validate: {
            validator: function(v) {
                return /@gmail\.com$/.test(v);
            },
            message: props => `${props.value} is not a valid Gmail address!`
        }
    },
    password: { type: String, required: true }, // No encryption
    rooms: { type: String, default: '' },
    rank:{type:String,required:true},
    likes:{type:Array , required:false}
});

module.exports =mongoose.model('User', UserSchema);